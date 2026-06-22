/**
 * Osonly 3D manifest extractor (v1, memory-safe).
 * Usage: node scripts/optimize-glb.mjs <assetId>
 *
 * Reads ONLY the glTF JSON chunk of the GLB (via HTTP Range) — never decodes
 * geometry, never re-encodes. Extracts node names + world-space bbox/centroid
 * (from the POSITION accessor min/max, which glTF requires) + triangle counts.
 *
 * Memory footprint ≈ size of the JSON chunk (KB), independent of model size —
 * so it stays well under a 512 MB instance. Heavy mesh optimization (Draco/
 * KTX2) is intentionally NOT done here; the developer pre-compresses the .glb.
 */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

try {
  await import('dotenv/config');
} catch {
  /* env inherited from parent */
}

const assetId = Number(process.argv[2]);
const prisma = new PrismaClient();

// ── tiny mat4 helpers (column-major) ────────────────────────────────────────
function fromTRS(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
  return o;
}
function xform(m, [x, y, z]) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}
function localMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
  return fromTRS(
    node.translation ?? [0, 0, 0],
    node.rotation ?? [0, 0, 0, 1],
    node.scale ?? [1, 1, 1],
  );
}

// ── fetch only the glTF JSON (no geometry) ──────────────────────────────────
async function fetchRange(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok && res.status !== 206) throw new Error(`range fetch ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function readGltfJson(url) {
  const head = await fetchRange(url, 0, 11);
  if (head.toString('ascii', 0, 4) === 'glTF') {
    const h = await fetchRange(url, 0, 19);
    const jsonLen = h.readUInt32LE(12);
    const jsonBuf = await fetchRange(url, 20, 20 + jsonLen - 1);
    return JSON.parse(jsonBuf.toString('utf8'));
  }
  // .gltf (plain JSON)
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return res.json();
}

function nodeRef(node) {
  const osonly = node.extras?.osonly;
  if (osonly?.kind === 'apartment')
    return { kind: 'apartment', ref: String(osonly.ref ?? node.name ?? '') };
  if (node.name && /^APT[_-]/i.test(node.name))
    return { kind: 'apartment', ref: node.name.replace(/^APT[_-]/i, '') };
  return null;
}

async function run() {
  const asset = await prisma.asset3D.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error(`Asset ${assetId} not found`);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const bucket = process.env.SUPABASE_BUCKET || 'oson-uy';

  const gltf = await readGltfJson(asset.rawUrl);
  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const accessors = gltf.accessors ?? [];
  const sceneIdx = gltf.scene ?? 0;
  const roots = gltf.scenes?.[sceneIdx]?.nodes ?? nodes.map((_, i) => i);

  const out = [];
  let triangles = 0;
  const sMin = [Infinity, Infinity, Infinity];
  const sMax = [-Infinity, -Infinity, -Infinity];

  const walk = (idx, parentWorld) => {
    const node = nodes[idx];
    if (!node) return;
    const world = mul(parentWorld, localMatrix(node));

    if (node.mesh != null && meshes[node.mesh]) {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      let has = false;
      for (const prim of meshes[node.mesh].primitives ?? []) {
        const posIdx = prim.attributes?.POSITION;
        const pos = posIdx != null ? accessors[posIdx] : null;
        const idxAcc = prim.indices != null ? accessors[prim.indices] : null;
        const count = idxAcc?.count ?? pos?.count ?? 0;
        triangles += count / 3;
        if (pos?.min && pos?.max) {
          has = true;
          for (let i = 0; i < 3; i++) {
            lo[i] = Math.min(lo[i], pos.min[i]);
            hi[i] = Math.max(hi[i], pos.max[i]);
          }
        }
      }

      let centroid = null;
      let wMin = null;
      let wMax = null;
      if (has) {
        wMin = [Infinity, Infinity, Infinity];
        wMax = [-Infinity, -Infinity, -Infinity];
        for (let xi = 0; xi < 2; xi++)
          for (let yi = 0; yi < 2; yi++)
            for (let zi = 0; zi < 2; zi++) {
              const c = xform(world, [
                xi ? hi[0] : lo[0],
                yi ? hi[1] : lo[1],
                zi ? hi[2] : lo[2],
              ]);
              for (let i = 0; i < 3; i++) {
                wMin[i] = Math.min(wMin[i], c[i]);
                wMax[i] = Math.max(wMax[i], c[i]);
                sMin[i] = Math.min(sMin[i], c[i]);
                sMax[i] = Math.max(sMax[i], c[i]);
              }
            }
        centroid = [
          +((wMin[0] + wMax[0]) / 2).toFixed(3),
          +((wMin[1] + wMax[1]) / 2).toFixed(3),
          +((wMin[2] + wMax[2]) / 2).toFixed(3),
        ];
      }

      const ref = nodeRef(node);
      out.push({
        node: node.name || `node_${idx}`,
        kind: ref?.kind ?? 'mesh',
        ...(ref?.ref ? { ref: ref.ref } : {}),
        ...(centroid ? { centroid, bbox: [wMin, wMax] } : {}),
      });
    }

    for (const child of node.children ?? []) walk(child, world);
  };

  for (const r of roots) walk(r, fromTRS([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]));

  const sceneBbox = isFinite(sMin[0]) ? [sMin, sMax] : null;
  const center = sceneBbox
    ? [
        (sMin[0] + sMax[0]) / 2,
        (sMin[1] + sMax[1]) / 2,
        (sMin[2] + sMax[2]) / 2,
      ]
    : [0, 0, 0];

  // The viewer loads the uploaded GLB directly (developer pre-compresses it).
  const manifest = {
    assetId: asset.id,
    sceneId: asset.sceneId,
    format: 'glb',
    url: asset.rawUrl,
    bbox: sceneBbox,
    center,
    triangles: Math.round(triangles),
    apartmentNodes: out.filter((n) => n.kind === 'apartment').length,
    nodes: out,
  };

  const manifestPath = `scenes-3d/manifests/${asset.sceneId}/${asset.id}-${Date.now()}.json`;
  const up = await supabase.storage
    .from(bucket)
    .upload(manifestPath, Buffer.from(JSON.stringify(manifest)), {
      contentType: 'application/json',
      upsert: true,
    });
  if (up.error) throw new Error(`storage upload (manifest) failed: ${up.error.message}`);
  const manifestUrl = supabase.storage.from(bucket).getPublicUrl(manifestPath)
    .data.publicUrl;

  await prisma.asset3D.update({
    where: { id: asset.id },
    data: {
      status: 'READY',
      optimizedUrl: asset.rawUrl,
      manifestUrl,
      triangles: Math.round(triangles),
      bbox: sceneBbox,
      error: null,
    },
  });

  console.log(
    `asset ${asset.id} READY — ${out.length} nodes (${manifest.apartmentNodes} apartments), ${Math.round(triangles)} tris`,
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
