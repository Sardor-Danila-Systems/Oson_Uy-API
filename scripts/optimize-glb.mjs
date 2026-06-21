/**
 * Osonly 3D asset pipeline (v0).
 * Usage: node scripts/optimize-glb.mjs <assetId>
 *
 * download raw GLB → optimize (dedup/prune/weld + Draco best-effort)
 *   → extract node manifest (apartment nodes + centroids + scene bbox)
 *   → upload optimized.glb + manifest.json to storage
 *   → update Asset3D (status READY) in the DB
 *
 * Runs out-of-process so gltf-transform/WASM never enters the Nest bundle.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

try {
  await import('dotenv/config');
} catch {
  /* dotenv optional — env is inherited from the parent process */
}

const assetId = Number(process.argv[2]);
const prisma = new PrismaClient();

function applyMat4(m, [x, y, z]) {
  // column-major 4x4 * (x,y,z,1)
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** classify node as apartment from extras.osonly or APT_ name convention */
function nodeRef(node) {
  const extras = node.getExtras?.() ?? {};
  const osonly = extras?.osonly;
  if (osonly?.kind === 'apartment') {
    return { kind: 'apartment', ref: String(osonly.ref ?? node.getName()) };
  }
  const name = node.getName() ?? '';
  if (/^APT[_-]/i.test(name)) {
    return { kind: 'apartment', ref: name.replace(/^APT[_-]/i, '') };
  }
  return null;
}

async function run() {
  const asset = await prisma.asset3D.findUnique({
    where: { id: assetId },
    include: { scene: true },
  });
  if (!asset) throw new Error(`Asset ${assetId} not found`);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const bucket = process.env.SUPABASE_BUCKET || 'oson-uy';

  // 1. download raw GLB
  const rawRes = await fetch(asset.rawUrl);
  if (!rawRes.ok) throw new Error(`download failed (${rawRes.status})`);
  const rawBytes = new Uint8Array(await rawRes.arrayBuffer());

  // 2. read with Draco-capable IO
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
  const document = await io.readBinary(rawBytes);

  // 3. manifest — node names, centroids, triangle count, scene bbox
  const nodes = [];
  let triangles = 0;
  const sceneMin = [Infinity, Infinity, Infinity];
  const sceneMax = [-Infinity, -Infinity, -Infinity];

  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    const localMin = [Infinity, Infinity, Infinity];
    const localMax = [-Infinity, -Infinity, -Infinity];

    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const idx = prim.getIndices();
      triangles += (idx ? idx.getCount() : pos.getCount()) / 3;
      const mn = pos.getMinNormalized ? pos.getMinNormalized([]) : pos.getMin([]);
      const mx = pos.getMaxNormalized ? pos.getMaxNormalized([]) : pos.getMax([]);
      for (let i = 0; i < 3; i++) {
        localMin[i] = Math.min(localMin[i], mn[i]);
        localMax[i] = Math.max(localMax[i], mx[i]);
      }
    }
    if (!isFinite(localMin[0])) continue;

    // world AABB from the 8 local corners
    const corners = [];
    for (let xi = 0; xi < 2; xi++)
      for (let yi = 0; yi < 2; yi++)
        for (let zi = 0; zi < 2; zi++)
          corners.push(
            applyMat4(world, [
              xi ? localMax[0] : localMin[0],
              yi ? localMax[1] : localMin[1],
              zi ? localMax[2] : localMin[2],
            ]),
          );
    const wMin = [Infinity, Infinity, Infinity];
    const wMax = [-Infinity, -Infinity, -Infinity];
    for (const c of corners)
      for (let i = 0; i < 3; i++) {
        wMin[i] = Math.min(wMin[i], c[i]);
        wMax[i] = Math.max(wMax[i], c[i]);
        sceneMin[i] = Math.min(sceneMin[i], c[i]);
        sceneMax[i] = Math.max(sceneMax[i], c[i]);
      }
    const centroid = [
      (wMin[0] + wMax[0]) / 2,
      (wMin[1] + wMax[1]) / 2,
      (wMin[2] + wMax[2]) / 2,
    ];

    const ref = nodeRef(node);
    nodes.push({
      node: node.getName() || `node_${nodes.length}`,
      kind: ref?.kind ?? 'mesh',
      ...(ref?.ref ? { ref: ref.ref } : {}),
      centroid: centroid.map((n) => Number(n.toFixed(3))),
      bbox: [wMin, wMax],
    });
  }

  // 4. optimize geometry (best-effort Draco)
  try {
    await document.transform(weld(), dedup(), prune());
    await document.transform(draco());
  } catch (e) {
    // fall back to uncompressed-but-cleaned if Draco fails on this model
    console.error('draco step skipped:', e?.message);
  }

  const optimized = await io.writeBinary(document);

  // 5. upload optimized GLB + manifest
  const base = `scenes-3d/optimized/${asset.sceneId}/${asset.id}-${Date.now()}`;
  const glbPath = `${base}.glb`;
  const manifestPath = `${base}.manifest.json`;
  const sceneBbox = isFinite(sceneMin[0]) ? [sceneMin, sceneMax] : null;
  const center = sceneBbox
    ? [
        (sceneMin[0] + sceneMax[0]) / 2,
        (sceneMin[1] + sceneMax[1]) / 2,
        (sceneMin[2] + sceneMax[2]) / 2,
      ]
    : [0, 0, 0];

  await supabase.storage.from(bucket).upload(glbPath, Buffer.from(optimized), {
    contentType: 'model/gltf-binary',
    upsert: true,
  });

  const glbUrl = supabase.storage.from(bucket).getPublicUrl(glbPath).data
    .publicUrl;

  const manifest = {
    assetId: asset.id,
    sceneId: asset.sceneId,
    format: 'glb',
    url: glbUrl,
    bbox: sceneBbox,
    center,
    triangles: Math.round(triangles),
    apartmentNodes: nodes.filter((n) => n.kind === 'apartment').length,
    nodes,
  };
  await supabase.storage
    .from(bucket)
    .upload(manifestPath, Buffer.from(JSON.stringify(manifest)), {
      contentType: 'application/json',
      upsert: true,
    });
  const manifestUrl = supabase.storage.from(bucket).getPublicUrl(manifestPath)
    .data.publicUrl;

  // 6. mark READY
  await prisma.asset3D.update({
    where: { id: asset.id },
    data: {
      status: 'READY',
      optimizedUrl: glbUrl,
      manifestUrl,
      triangles: Math.round(triangles),
      bbox: sceneBbox,
      sizeBytes: BigInt(optimized.byteLength),
      error: null,
    },
  });

  console.log(
    `asset ${asset.id} READY — ${nodes.length} nodes, ${Math.round(triangles)} tris, ${(optimized.byteLength / 1024 / 1024).toFixed(2)} MB`,
  );
}

run()
  .catch(async (e) => {
    console.error('PIPELINE ERROR:', e?.message);
    try {
      await prisma.asset3D.update({
        where: { id: assetId },
        data: { status: 'FAILED', error: String(e?.message).slice(0, 500) },
      });
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
