import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ConstructionStageKey,
  Developer,
  Prisma,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { FilterProjectDto } from './dto/filter-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateBuildingProgressDto } from './dto/update-building-progress.dto';

type ProjectWithRelations = Prisma.ProjectGetPayload<{
  include: {
    developer: true;
    media: true;
    floors: {
      include: { areaOptions: true; layouts: true };
    };
    leads: { include: { feedback: true } };
    subscription: true;
    progressMilestones: true;
  };
}>;

type CarouselProjectPayload = {
  id: number;
  name: string;
  location: string;
  district: string | null;
  imageUrl: string;
  deliveryDate: string;
  hasInstallment: boolean;
  latitude: number | null;
  longitude: number | null;
  floors: { pricePerM2: number }[];
  media: { imageUrl: string }[];
};

type CarouselProjectSummary = {
  id: number;
  name: string;
  location: string;
  district: string | null;
  imageUrl: string;
  deliveryDate: string;
  hasInstallment: boolean;
  priceFrom: number | null;
};

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  private static readonly constructionStageOrder: ConstructionStageKey[] = [
    ConstructionStageKey.FOUNDATION,
    ConstructionStageKey.FRAME,
    ConstructionStageKey.FACADE,
    ConstructionStageKey.INTERIOR,
    ConstructionStageKey.LANDSCAPING,
  ];

  private static readonly floorInclude = {
    areaOptions: { orderBy: { sortOrder: 'asc' as const } },
    layouts: { orderBy: { sortOrder: 'asc' as const } },
  };

  private static readonly carouselSelect = {
    id: true,
    name: true,
    location: true,
    district: true,
    imageUrl: true,
    deliveryDate: true,
    hasInstallment: true,
    latitude: true,
    longitude: true,
    floors: { select: { pricePerM2: true } },
    media: {
      orderBy: { sortOrder: 'asc' as const },
      take: 1,
      select: { imageUrl: true },
    },
  } satisfies Prisma.ProjectSelect;

  private static readonly progressOrderBy = {
    orderBy: { sortOrder: 'asc' as const },
  };

  private computeProgress(milestones: { done: boolean }[]) {
    const total = milestones.length;
    const done = milestones.filter((m) => m.done).length;
    const percent = total ? Math.floor((done / total) * 100) : null;
    return { total, done, percent };
  }

  static toCatalogDeveloper(developer: Developer) {
    return {
      id: developer.id,
      name: developer.name,
      email: developer.email,
      qrCodeUrl: developer.qrCodeUrl,
      phone: developer.phone,
      legalAddress: developer.legalAddress,
      officeAddress: developer.officeAddress,
      website: developer.website,
      description: developer.description,
      logoUrl: developer.logoUrl,
      createdAt: developer.createdAt,
    };
  }

  private static haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async create(createProjectDto: CreateProjectDto) {
    const { imageUrls, ...projectData } = createProjectDto;
    this.ensureImageQuota(imageUrls, SubscriptionPlan.START);
    const project = await this.prisma.project.create({
      data: {
        ...projectData,
        media: imageUrls?.length
          ? {
              create: imageUrls.map((imageUrl, index) => ({
                imageUrl,
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: {
        developer: true,
        floors: { include: ProjectsService.floorInclude },
        media: true,
        progressMilestones: ProjectsService.progressOrderBy,
      },
    });
    await this.prisma.projectSubscription.create({
      data: {
        projectId: project.id,
        plan: SubscriptionPlan.START,
        status: SubscriptionStatus.TRIAL,
        trialStartsAt: new Date(),
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await this.prisma.projectMember.upsert({
      where: {
        projectId_developerId: {
          projectId: project.id,
          developerId: project.developerId,
        },
      },
      update: {},
      create: {
        projectId: project.id,
        developerId: project.developerId,
        role: 'OWNER',
      },
    });
    await this.ensureBuildingProgress(project.id);
    return {
      ...project,
      developer: ProjectsService.toCatalogDeveloper(project.developer),
    };
  }

  async findAll(filters?: FilterProjectDto) {
    const where: Prisma.ProjectWhereInput = {};

    if (filters?.location) {
      where.location = { contains: filters.location, mode: 'insensitive' };
    }

    if (filters?.hasInstallment === true) {
      where.hasInstallment = true;
    }
    if (filters?.hasInstallment === false) {
      where.hasInstallment = false;
    }

    const projects = await this.prisma.project.findMany({
      where,
      include: {
        developer: true,
        media: {
          orderBy: { sortOrder: 'asc' },
        },
        floors: {
          include: ProjectsService.floorInclude,
        },
        leads: {
          include: {
            feedback: true,
          },
        },
        subscription: true,
        progressMilestones: ProjectsService.progressOrderBy,
      },
    });

    const filtered = projects.filter((project) =>
      this.projectMatchesFilters(project, filters),
    );

    return filtered.map((project) => this.enrichProject(project));
  }

  /**
   * Projects owned by (or shared with) the authenticated developer only.
   * Used by the dashboard so developers never see each other's projects.
   */
  async findMine(developerId: number, filters?: FilterProjectDto) {
    const where: Prisma.ProjectWhereInput = {
      OR: [
        { developerId },
        { members: { some: { developerId } } },
      ],
    };

    if (filters?.location) {
      where.location = { contains: filters.location, mode: 'insensitive' };
    }
    if (filters?.hasInstallment === true) where.hasInstallment = true;
    if (filters?.hasInstallment === false) where.hasInstallment = false;

    const projects = await this.prisma.project.findMany({
      where,
      include: {
        developer: true,
        media: { orderBy: { sortOrder: 'asc' } },
        floors: { include: ProjectsService.floorInclude },
        leads: { include: { feedback: true } },
        subscription: true,
        progressMilestones: ProjectsService.progressOrderBy,
      },
    });

    const filtered = projects.filter((project) =>
      this.projectMatchesFilters(project, filters),
    );

    return filtered.map((project) => this.enrichProject(project));
  }

  async findOne(id: number) {
    const project = await this.loadProjectOrThrow(id);
    const enriched = this.enrichProject(project);
    const [siblingProjects, nearbyProjects] = await Promise.all([
      this.findSiblingProjects(project),
      this.findNearbyProjects(project),
    ]);
    return { ...enriched, siblingProjects, nearbyProjects };
  }

  async findFullById(id: number) {
    return this.findOne(id);
  }

  async update(id: number, updateProjectDto: UpdateProjectDto) {
    const currentRaw = await this.loadProjectOrThrow(id);
    const { imageUrls, ...projectData } = updateProjectDto;
    this.ensureImageQuota(
      imageUrls,
      currentRaw.subscription?.plan ?? SubscriptionPlan.START,
    );

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...projectData,
        media: imageUrls
          ? {
              deleteMany: {},
              create: imageUrls.map((imageUrl, index) => ({
                imageUrl,
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: {
        developer: true,
        floors: { include: ProjectsService.floorInclude },
        media: true,
        subscription: true,
        progressMilestones: ProjectsService.progressOrderBy,
      },
    });
    return {
      ...updated,
      developer: ProjectsService.toCatalogDeveloper(updated.developer),
    };
  }

  private async loadProjectOrThrow(id: number): Promise<ProjectWithRelations> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        developer: true,
        floors: {
          include: ProjectsService.floorInclude,
        },
        media: {
          orderBy: { sortOrder: 'asc' },
        },
        leads: {
          include: {
            feedback: true,
          },
        },
        subscription: true,
        progressMilestones: ProjectsService.progressOrderBy,
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  private toCarouselProject(row: CarouselProjectPayload): CarouselProjectSummary {
    const prices = row.floors.map((f) => f.pricePerM2).filter((p) => p > 0);
    const priceFrom = prices.length ? Math.min(...prices) : null;
    const thumb =
      row.imageUrl?.trim() || row.media[0]?.imageUrl?.trim() || '';
    return {
      id: row.id,
      name: row.name,
      location: row.location,
      district: row.district,
      imageUrl: thumb,
      deliveryDate: row.deliveryDate,
      hasInstallment: row.hasInstallment,
      priceFrom,
    };
  }

  private async findSiblingProjects(project: ProjectWithRelations) {
    const rows = await this.prisma.project.findMany({
      where: { developerId: project.developerId, id: { not: project.id } },
      take: 12,
      orderBy: { id: 'desc' },
      select: ProjectsService.carouselSelect,
    });
    return rows.map((r) => this.toCarouselProject(r as CarouselProjectPayload));
  }

  private async findNearbyProjects(project: ProjectWithRelations) {
    const limit = 12;
    const picked = new Set<number>([project.id]);
    const out: CarouselProjectSummary[] = [];

    const pushUnique = (rows: CarouselProjectPayload[], need: number) => {
      for (const r of rows) {
        if (out.length >= need) return;
        if (picked.has(r.id)) continue;
        picked.add(r.id);
        out.push(this.toCarouselProject(r));
      }
    };

    if (project.latitude != null && project.longitude != null) {
      const withCoords = await this.prisma.project.findMany({
        where: {
          id: { not: project.id },
          latitude: { not: null },
          longitude: { not: null },
          location: { equals: project.location, mode: 'insensitive' },
        },
        take: 80,
        select: ProjectsService.carouselSelect,
      });
      const sorted = (withCoords as CarouselProjectPayload[])
        .map((p) => ({
          p,
          km: ProjectsService.haversineKm(
            project.latitude!,
            project.longitude!,
            p.latitude!,
            p.longitude!,
          ),
        }))
        .sort((a, b) => a.km - b.km)
        .map((x) => x.p);
      pushUnique(sorted, limit);
    }

    if (out.length < limit && project.district) {
      const rows = await this.prisma.project.findMany({
        where: {
          id: { notIn: [...picked] },
          district: { equals: project.district, mode: 'insensitive' },
        },
        take: limit - out.length + 5,
        select: ProjectsService.carouselSelect,
      });
      pushUnique(rows as CarouselProjectPayload[], limit);
    }

    if (out.length < limit) {
      const rows = await this.prisma.project.findMany({
        where: {
          id: { notIn: [...picked] },
          location: { equals: project.location, mode: 'insensitive' },
        },
        take: limit - out.length + 8,
        select: ProjectsService.carouselSelect,
      });
      pushUnique(rows as CarouselProjectPayload[], limit);
    }

    return out;
  }

  private projectMatchesFilters(
    project: ProjectWithRelations,
    filters?: FilterProjectDto,
  ): boolean {
    if (!filters) return true;

    if (
      filters.hasInstallment === true &&
      project.hasInstallment !== true
    ) {
      return false;
    }
    if (
      filters.hasInstallment === false &&
      project.hasInstallment !== false
    ) {
      return false;
    }

    const hasPrice =
      filters.pricePerM2Min != null || filters.pricePerM2Max != null;

    if (!hasPrice) {
      return true;
    }

    return project.floors.some((f) => this.floorMatchesFilters(f, filters));
  }

  private floorMatchesFilters(
    floor: ProjectWithRelations['floors'][0],
    filters: FilterProjectDto,
  ): boolean {
    if (
      filters.pricePerM2Min != null &&
      floor.pricePerM2 < filters.pricePerM2Min
    ) {
      return false;
    }
    if (
      filters.pricePerM2Max != null &&
      floor.pricePerM2 > filters.pricePerM2Max
    ) {
      return false;
    }

    return true;
  }

  private enrichProject(project: ProjectWithRelations) {
    const feedbacks = project.leads
      .map((lead) => lead.feedback)
      .filter((feedback) => Boolean(feedback?.rating));
    const reviewsCount = feedbacks.length;
    const avgRating = reviewsCount
      ? Number(
          (
            feedbacks.reduce((sum, review) => sum + (review.rating ?? 0), 0) /
            reviewsCount
          ).toFixed(1),
        )
      : null;
    const reviews = feedbacks.slice(0, 5).map((feedback, index) => ({
      id: index + 1,
      rating: feedback.rating ?? 0,
      comment: feedback.comment,
    }));

    const { developer, ...rest } = project;
    const progressStats = this.computeProgress(project.progressMilestones ?? []);

    return {
      ...rest,
      developer: ProjectsService.toCatalogDeveloper(developer),
      isPopular:
        project.subscription?.plan === SubscriptionPlan.PREMIUM ||
        project.subscription?.plan === SubscriptionPlan.ULTIMATE,
      badgeVerified:
        project.subscription?.plan === SubscriptionPlan.PRO ||
        project.subscription?.plan === SubscriptionPlan.PREMIUM ||
        project.subscription?.plan === SubscriptionPlan.ULTIMATE,
      badgeTrusted: project.subscription?.plan === SubscriptionPlan.ULTIMATE,
      topInCatalog:
        project.subscription?.plan === SubscriptionPlan.PREMIUM ||
        project.subscription?.plan === SubscriptionPlan.ULTIMATE,
      topInHome: project.subscription?.plan === SubscriptionPlan.ULTIMATE,
      reviews,
      reviewsCount,
      avgRating,
      progress: {
        ...progressStats,
        milestones: (project.progressMilestones ?? []).map((m) => ({
          id: m.id,
          title: m.title,
          done: m.done,
          sortOrder: m.sortOrder,
          photoUrls: (m as any).photoUrls ?? [],
        })),
      },
    };
  }

  async getProgress(projectId: number) {
    await this.loadProjectOrThrow(projectId);
    const rows = await this.prisma.projectProgressMilestone.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
    });
    const progressStats = this.computeProgress(rows);

    return {
      ...progressStats,
      milestones: rows.map((m) => ({
        id: m.id,
        title: m.title,
        done: m.done,
        sortOrder: m.sortOrder,
        photoUrls: (m as any).photoUrls ?? [],
      })),
    };
  }

  async ensureBuildingProgress(projectId: number) {
    const existing = await this.prisma.buildingProgress.findUnique({
      where: { projectId },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
    if (existing) return existing;
    return this.prisma.buildingProgress.create({
      data: {
        projectId,
        percentComplete: 0,
        stages: {
          create: ProjectsService.constructionStageOrder.map((stageKey, i) => ({
            stageKey,
            sortOrder: i,
            done: false,
          })),
        },
      },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async updateBuildingProgress(
    projectId: number,
    dto: UpdateBuildingProgressDto,
  ) {
    await this.loadProjectOrThrow(projectId);
    const bp = await this.ensureBuildingProgress(projectId);

    if (dto.stages?.length) {
      for (const s of dto.stages) {
        await this.prisma.constructionStage.updateMany({
          where: {
            buildingProgressId: bp.id,
            stageKey: s.stageKey,
          },
          data: { done: s.done },
        });
      }
    }

    if (dto.percentComplete != null) {
      return this.prisma.buildingProgress.update({
        where: { id: bp.id },
        data: { percentComplete: dto.percentComplete },
        include: { stages: { orderBy: { sortOrder: 'asc' } } },
      });
    }

    return this.prisma.buildingProgress.findUniqueOrThrow({
      where: { id: bp.id },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async replaceProgress(
    projectId: number,
    milestones: {
      title: string;
      done: boolean;
      sortOrder: number;
      photoUrls?: string[];
    }[],
  ) {
    await this.loadProjectOrThrow(projectId);
    const normalized = (milestones ?? [])
      .filter((m) => Boolean(String(m?.title ?? '').trim()))
      .map((m, idx) => ({
        title: String(m.title).trim(),
        done: Boolean(m.done),
        photoUrls: Array.isArray(m.photoUrls)
          ? m.photoUrls.map((u) => String(u).trim()).filter(Boolean).slice(0, 12)
          : [],
        sortOrder:
          Number.isFinite(Number(m.sortOrder)) && Number(m.sortOrder) >= 0
            ? Number(m.sortOrder)
            : idx,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m, idx) => ({ ...m, sortOrder: idx }));

    await this.prisma.$transaction([
      this.prisma.projectProgressMilestone.deleteMany({
        where: { projectId },
      }),
      ...(normalized.length
        ? [
            this.prisma.projectProgressMilestone.createMany({
              data: normalized.map((m) => ({
                projectId,
                title: m.title,
                done: m.done,
                sortOrder: m.sortOrder,
                photoUrls: m.photoUrls,
              })),
            }),
          ]
        : []),
    ]);

    return this.getProgress(projectId);
  }

  private ensureImageQuota(
    imageUrls: string[] | undefined,
    plan: SubscriptionPlan,
  ) {
    if (!imageUrls) return;
    const limits: Record<SubscriptionPlan, number> = {
      START: 3,
      PRO: 5,
      PREMIUM: 7,
      ULTIMATE: Number.POSITIVE_INFINITY,
    };
    if (imageUrls.length > limits[plan]) {
      throw new NotFoundException(
        `Plan ${plan} allows maximum ${limits[plan]} images`,
      );
    }
  }
}
