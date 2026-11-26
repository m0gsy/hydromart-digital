// Build the kecamatan / kelurahan boundary asset customer-service uses to name the region a pin
// falls in (HD-20a).
//
//   node scripts/build-region-asset.mjs <idn_admin_boundaries.geojson.zip> <empty work dir> [--tolerance 0.0003]
//
// Source: HDX COD-AB Indonesia (https://data.humdata.org/dataset/cod-ab-idn), BPS 2020 boundaries,
// CC BY-IGO. The zip is untrusted input: it is unpacked into the (new) work dir you name, outside
// the repo, and only read as text. Nothing in it is executed.
//
// Keeps the provinces DKI Jakarta (31), Jawa Barat (32) and Banten (36), every ADM3 (kecamatan)
// and ADM4 (kelurahan/desa) polygon, with its BPS code (the pcode without the "ID" prefix), name
// and parent code, each ring simplified with Douglas-Peucker and rounded to 4 decimals (~11 m).
// Writes services/customer-service/src/infrastructure/geo/regions.json. See data/README.md there.
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROVINCES = new Set(['ID31', 'ID32', 'ID36']);
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../services/customer-service/src/infrastructure/geo/regions.json',
);

const args = process.argv.slice(2);
const ti = args.indexOf('--tolerance');
const TOLERANCE = ti >= 0 ? Number(args.splice(ti, 2)[1]) : 0.0003; // degrees, ~33 m
const [zip, work] = args;
if (!zip || !work || !(TOLERANCE > 0)) {
  console.error('usage: node scripts/build-region-asset.mjs <zip> <work dir> [--tolerance deg]');
  process.exit(2);
}

mkdirSync(work, { recursive: true });
if (readdirSync(work).length === 0) {
  // Windows ships bsdtar (reads zip); git-bash's GNU tar does not.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
  const r = spawnSync(tar, ['-xf', resolve(zip), '-C', resolve(work), 'idn_admin3.geojson', 'idn_admin4.geojson'], {
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(1);
}

// Douglas-Peucker on a flat [x,y,...] open polyline, iterative (rings have thousands of points).
function simplify(pts, tol) {
  const n = pts.length / 2;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = -1;
    let at = -1;
    const ax = pts[2 * a], ay = pts[2 * a + 1], dx = pts[2 * b] - ax, dy = pts[2 * b + 1] - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i += 1) {
      const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
      let d2;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const u = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - u * dx, ey = py - u * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > max) { max = d2; at = i; }
    }
    if (max > t2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;

function toPolygons(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const out = [];
  for (const poly of polys) {
    const rings = [];
    for (const ring of poly) {
      const flat = ring.flatMap((p) => [p[0], p[1]]);
      const s = simplify(flat, TOLERANCE).map(r4);
      // A ring that collapsed below a triangle (+ closing point) is a sliver: drop it. A dropped
      // outer ring drops its holes with it.
      if (s.length >= 8) rings.push(s);
      else if (rings.length === 0) break;
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

async function read(file, level) {
  const out = [];
  let seen = 0;
  const rl = createInterface({ input: createReadStream(join(work, file), { encoding: 'utf8' }) });
  for await (const raw of rl) {
    if (!raw.startsWith('{"type":"Feature"')) continue;
    seen += 1;
    const f = JSON.parse(raw.replace(/,$/, ''));
    const p = f.properties;
    if (!PROVINCES.has(p.adm1_pcode) || !f.geometry) continue;
    const g = toPolygons(f.geometry);
    if (!g.length) continue;
    const xs = g.flat(2).filter((_, i) => i % 2 === 0);
    const ys = g.flat(2).filter((_, i) => i % 2 === 1);
    const feat = {
      c: p[`adm${level}_pcode`].slice(2),
      n: p[`adm${level}_name`],
      ...(level === 4 ? { p: p.adm3_pcode.slice(2) } : {}),
      b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      g,
    };
    out.push(feat);
  }
  console.log(`adm${level}: ${seen} read, ${out.length} kept`);
  return out;
}

const adm3 = await read('idn_admin3.geojson', 3);
const adm4 = await read('idn_admin4.geojson', 4);
const json = JSON.stringify({ adm3, adm4 });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
const pts = (fs) => fs.reduce((s, f) => s + f.g.flat(2).length / 2, 0);
console.log(`tolerance ${TOLERANCE} deg; points adm3 ${pts(adm3)}, adm4 ${pts(adm4)}`);
console.log(`wrote ${OUT}: ${(statSync(OUT).size / 1e6).toFixed(2)} MB`);
