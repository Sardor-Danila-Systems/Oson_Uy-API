import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import { PrismaService } from '../prisma.service';
import { MediaService } from '../media/media.service';

type Spawn = { position?: number[]; target?: number[] };

@Injectable()
export class Scenes3DService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  private async assertMember(projectId: number, developerId: number) {
    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, developerId },
    });
    if (!member) throw new ForbiddenException('No access to this project');
  }

  private async ensureScene(projectId: number) {
    return this.prisma.scene3D.upsert({
      where: { projectId },
      update: {},
      create: { projectId, status: 'DRAFT' },
    });
  }

  // ── Public (viewer) ─────────────────────────────────────────────────────────

  /** Scene state for the WebGL viewer: published manifest + live apartment data. */
  async getPublicScene(projectId: number) {
    const scene = await this.prisma.scene3D.findUnique({
      where: { projectId },
    });

    const apartments = await this.prisma.apartmentUnit.findMany({
      where: { projectId, meshNode: { not: null } },
      select: {
        id: true,
        meshNode: true,
        status: true,
        priceUzs: true,
        pricePerM2Uzs: true,
        areaSqm: true,
        rooms: true,
        floor: true,
        number: true,
        sectionKey: true,
        buildingId: true,
      },
    });

    return {
      projectId,
      status: scene?.status ?? 'DRAFT',
      version: scene?.version ?? 0,
      manifestUrl: scene?.status === 'READY' ? scene?.manifestUrl ?? null : null,
      spawnPosition: scene?.spawnPosition ?? null,
      spawnTarget: scene?.spawnTarget ?? null,
      apartments,
    };
  }

  // ── Dashboard: assets ───────────────────────────────────────────────────────

  async listAssets(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);
    const scene = await this.prisma.scene3D.findUnique({
      where: { projectId },
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
      },
    });
    const mappedCount = await this.prisma.apartmentUnit.count({
      where: { projectId, meshMapped: true },
    });
    const totalApartments = await this.prisma.apartmentUnit.count({
      where: { projectId },
    });
    return {
      scene: scene
        ? {
            id: scene.id,
            status: scene.status,
            version: scene.version,
            publishedAssetId: scene.publishedAssetId,
            manifestUrl: scene.manifestUrl,
          }
        : null,
      assets: scene?.assets ?? [],
      mappedCount,
      totalApartments,
    };
  }

  async uploadAsset(
    projectId: number,
    developerId: number,
    file: Express.Multer.File | undefined,
    body: { kind?: string; buildingKey?: string; format?: string },
  ) {
    await this.assertMember(projectId, developerId);
    if (!file) throw new BadRequestException('Файл модели обязателен');

    const isGlb = /\.(glb|gltf)$/i.test(file.originalname);
    if (!isGlb) {
      throw new BadRequestException('Допускаются только модели .glb / .gltf');
    }

    const scene = await this.ensureScene(projectId);

    let buildingId: number | null = null;
    if (body.buildingKey?.trim()) {
      const key = body.buildingKey.trim();
      const building = await this.prisma.building.upsert({
        where: { projectId_key: { projectId, key } },
        update: {},
        create: { projectId, key, name: key },
      });
      buildingId = building.id;
    }

    const rawUrl = await this.media.uploadDocument(file, 'scenes-3d/raw');

    const kind = (body.kind ?? 'EXTERIOR').toUpperCase();
    const validKind = ['EXTERIOR', 'INTERIOR', 'SITE', 'TILESET'].includes(kind)
      ? (kind as 'EXTERIOR' | 'INTERIOR' | 'SITE' | 'TILESET')
      : 'EXTERIOR';

    return this.prisma.asset3D.create({
      data: {
        sceneId: scene.id,
        buildingId,
        kind: validKind,
        format: body.format === '3dtiles' ? '3dtiles' : 'glb',
        status: 'UPLOADED',
        rawUrl,
        sizeBytes: BigInt(file.size),
      },
    });
  }

  /** Kick off the optimization pipeline (download → optimize → manifest → upload). */
  async processAsset(projectId: number, assetId: number, developerId: number) {
    await this.assertMember(projectId, developerId);
    const asset = await this.prisma.asset3D.findFirst({
      where: { id: assetId, scene: { projectId } },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    await this.prisma.asset3D.update({
      where: { id: assetId },
      data: { status: 'PROCESSING', error: null },
    });

    // Run the pipeline out-of-process so gltf-transform/WASM never enters the
    // Nest webpack bundle and never blocks the request thread.
    const script = path.join(process.cwd(), 'scripts', 'optimize-glb.mjs');
    const child = spawn(process.execPath, [script, String(assetId)], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();

    return { ok: true, assetId, status: 'PROCESSING' };
  }

  // ── Dashboard: mesh ↔ apartment mapping ─────────────────────────────────────

  /** Manifest nodes + apartments, for the mapper UI. */
  async getMappingState(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);

    const scene = await this.prisma.scene3D.findUnique({
      where: { projectId },
      include: { assets: { where: { status: 'READY' }, orderBy: { createdAt: 'desc' } } },
    });

    let nodes: { node: string; ref?: string; centroid?: number[] }[] = [];
    const manifestUrl = scene?.assets?.[0]?.manifestUrl ?? scene?.manifestUrl;
    if (manifestUrl) {
      try {
        const res = await fetch(manifestUrl);
        if (res.ok) {
          const manifest = (await res.json()) as {
            nodes?: { node: string; ref?: string; centroid?: number[] }[];
          };
          nodes = manifest.nodes ?? [];
        }
      } catch {
        /* manifest not reachable yet */
      }
    }

    const apartments = await this.prisma.apartmentUnit.findMany({
      where: { projectId },
      select: {
        id: true,
        number: true,
        sectionKey: true,
        floor: true,
        rooms: true,
        status: true,
        meshNode: true,
        meshMapped: true,
      },
      orderBy: [{ sectionKey: 'asc' }, { floor: 'asc' }, { number: 'asc' }],
    });

    const mappedNodes = new Set(
      apartments.map((a) => a.meshNode).filter(Boolean) as string[],
    );
    const unmappedNodes = nodes.filter((n) => !mappedNodes.has(n.node));

    return { nodes, unmappedNodes, apartments };
  }

  async mapApartment(
    projectId: number,
    developerId: number,
    apartmentId: number,
    meshNode: string | null,
  ) {
    await this.assertMember(projectId, developerId);
    const apt = await this.prisma.apartmentUnit.findFirst({
      where: { id: apartmentId, projectId },
    });
    if (!apt) throw new NotFoundException('Apartment not found');
    return this.prisma.apartmentUnit.update({
      where: { id: apartmentId },
      data: {
        meshNode: meshNode?.trim() || null,
        meshMapped: Boolean(meshNode?.trim()),
      },
      select: { id: true, meshNode: true, meshMapped: true },
    });
  }

  /** Auto-map apartments to mesh nodes by name convention (APT_{block}_{floor}_{number}). */
  async autoMap(projectId: number, developerId: number) {
    await this.assertMember(projectId, developerId);

    const state = await this.getMappingState(projectId, developerId);
    const nodeByRef = new Map<string, string>();
    for (const n of state.nodes) {
      const key = (n.ref ?? n.node).toUpperCase().replace(/[^A-Z0-9]/g, '');
      nodeByRef.set(key, n.node);
    }

    let mapped = 0;
    for (const apt of state.apartments) {
      if (apt.meshMapped) continue;
      const candidates = [
        `APT${apt.sectionKey}${apt.floor}${apt.number}`,
        `${apt.sectionKey}${apt.floor}${apt.number}`,
        `APT${apt.sectionKey}F${apt.floor}${apt.number}`,
      ].map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ''));

      const hit = candidates.map((c) => nodeByRef.get(c)).find(Boolean);
      if (hit) {
        await this.prisma.apartmentUnit.update({
          where: { id: apt.id },
          data: { meshNode: hit, meshMapped: true },
        });
        mapped += 1;
      }
    }
    return { mapped, total: state.apartments.length };
  }

  // ── Dashboard: publish ──────────────────────────────────────────────────────

  async publish(
    projectId: number,
    developerId: number,
    assetId: number,
    spawn?: Spawn,
  ) {
    await this.assertMember(projectId, developerId);
    const asset = await this.prisma.asset3D.findFirst({
      where: { id: assetId, scene: { projectId }, status: 'READY' },
    });
    if (!asset || !asset.manifestUrl) {
      throw new BadRequestException(
        'Asset не обработан. Дождитесь статуса READY.',
      );
    }

    const scene = await this.ensureScene(projectId);
    return this.prisma.scene3D.update({
      where: { id: scene.id },
      data: {
        status: 'READY',
        publishedAssetId: assetId,
        manifestUrl: asset.manifestUrl,
        version: scene.version + 1,
        ...(spawn?.position ? { spawnPosition: spawn.position } : {}),
        ...(spawn?.target ? { spawnTarget: spawn.target } : {}),
      },
    });
  }

  async deleteAsset(projectId: number, developerId: number, assetId: number) {
    await this.assertMember(projectId, developerId);
    const asset = await this.prisma.asset3D.findFirst({
      where: { id: assetId, scene: { projectId } },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    await this.prisma.asset3D.delete({ where: { id: assetId } });
    return { ok: true };
  }
}
