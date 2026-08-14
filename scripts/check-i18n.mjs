#!/usr/bin/env node
/**
 * Indonesian UI copy that never reaches the translator.
 *
 * PR-8 translated 478 strings and the scanner then reported clean — twice — while the
 * ENTIRE console navigation was still hardcoded. It read JSX text and a fixed list of
 * props, and every navigation label lives in a module-level object literal
 * (`{ href: '/hr/employees', label: 'Karyawan' }`), which it never looked at. A browser
 * pass found it: the right half of the screen was English and the whole menu beside it
 * was Indonesian.
 *
 * So this reads object-literal `label:` / `title:` / `name:` / `text:` properties too,
 * and runs in CI — a scanner nobody runs is the same as no scanner.
 *
 *   node scripts/check-i18n.mjs            # gate: exit 1 on any finding
 *   node scripts/check-i18n.mjs --list     # print every string, grouped by file
 *
 * Detection is a stop-word list, not a language model: a string is copy when it contains
 * an Indonesian function word or a domain noun this app says out loud. That misses an
 * English-looking label ("Dashboard") on purpose — those are the same in both locales and
 * chasing them would drown the signal that matters.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'apps/web/src';

const ID_WORDS = [
  'yang', 'dan', 'atau', 'tidak', 'belum', 'sudah', 'akan', 'ini', 'itu', 'untuk', 'dari',
  'dengan', 'pada', 'per', 'ada', 'bisa', 'harus', 'wajib', 'saja', 'juga',
  'semua', 'setiap', 'lebih', 'kurang', 'baru', 'lama', 'hari', 'bulan', 'tahun', 'minggu',
  'jam', 'menit', 'tanggal', 'nama', 'jumlah', 'nilai', 'harga', 'biaya', 'gaji',
  'karyawan', 'pegawai', 'depot', 'pesanan', 'pelanggan', 'kurir', 'stok', 'galon', 'poin',
  'simpan', 'batal', 'hapus', 'ubah', 'tambah', 'cari', 'pilih', 'kirim', 'muat', 'lihat',
  'kembali', 'lanjut', 'selesai', 'gagal', 'berhasil', 'kosong', 'aktif', 'nonaktif',
  'tersedia', 'terpakai', 'masuk', 'keluar', 'catatan', 'keterangan', 'jenis',
  'periode', 'laporan', 'ringkasan', 'rincian', 'daftar', 'riwayat', 'pengaturan',
  'dibuat', 'diubah', 'dihapus', 'disetujui', 'ditolak', 'menunggu', 'dibayar', 'terlambat',
  'hadir', 'absen', 'cuti', 'izin', 'libur', 'jabatan', 'departemen', 'atasan',
  'bawahan', 'cabang', 'pusat', 'kantor', 'opsional', 'anda', 'kamu',
  'sedang', 'sedikit', 'banyak', 'antar', 'pengiriman', 'penjualan', 'pembelian',
  'pembayaran', 'setoran', 'penarikan', 'kasir', 'gudang', 'jadwal', 'tugas', 'lembur',
  'potongan', 'tunjangan', 'pinjaman', 'hadiah', 'langganan', 'keranjang', 'alamat',
  'akun', 'sandi', 'masalah', 'bantuan', 'ulasan', 'penilaian', 'target', 'capaian',
  // Imperatives. The list started without them and missed a bare `>Setujui</Button>`.
  'setujui', 'tolak', 'kelola', 'buat', 'tutup', 'cetak', 'unduh', 'ekspor', 'impor',
  'ganti', 'atur', 'mulai', 'ambil', 'terima', 'tunggu', 'ulangi', 'coba', 'periksa',
];
const ID_RE = new RegExp(`(^|[^a-zA-Z])(${ID_WORDS.join('|')})([^a-zA-Z]|$)`, 'i');

/** Plainly not UI copy. */
function isCode(s) {
  if (!/[a-zA-Z]/.test(s)) return true;
  if (/^[A-Z0-9_]+$/.test(s)) return true; // enum member
  if (/^[a-z][a-zA-Z0-9]*$/.test(s)) return true; // identifier
  if (/^https?:|^\/|^#|^\w+\/\w+/.test(s)) return true; // url / path / mime
  if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/.test(s)) return true; // dictionary key
  return false;
}

/** Directories whose strings are not user-facing copy, or are the copy itself. */
const SKIP_DIR = new Set(['node_modules', 'dictionaries', '__tests__', '__mocks__']);
/** Files that hold literals on purpose — a value sent to an API, not something read. */
const SKIP_FILE = /\.(test|spec)\.tsx?$/;
/**
 * `app/global-error.tsx` catches a failure in the ROOT layout — which is where
 * LocaleProvider lives. It renders its own <html>/<body> with inline styles precisely
 * because nothing around it can be trusted to work, so there is no translator to call
 * and never will be. Skipped by path rather than by three JSX comments inside it.
 */
const SKIP_PATH = new Set(['app/global-error.tsx']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(p, out);
    } else if (/\.tsx?$/.test(p) && !SKIP_FILE.test(p)) out.push(p);
  }
  return out;
}

const PATTERNS = [
  // JSX text node on one line, no interpolation.
  { kind: 'jsx', re: />([^<>{}\n]{3,})</g },
  // JSX props that render.
  {
    kind: 'prop',
    re: /(?:label|title|placeholder|aria-label|heading|hint|emptyText|alt)\s*=\s*(?:"([^"]{3,})"|'([^']{3,})'|\{'([^']{3,})'\}|\{"([^"]{3,})"\})/g,
  },
  // THE ONE THAT WAS MISSING: object-literal properties. Every console nav is a module
  // -level array of `{ href, label }`, which no earlier pattern here could see.
  {
    kind: 'object',
    re: /(?:^|[{,[\s])(?:label|title|name|text|description|caption|placeholder|summary|subtitle|heading|message|hint|tooltip)\s*:\s*(?:'([^']{3,})'|"([^"]{3,})"|`([^`${}]{3,})`)/gm,
  },
  // Messages handed straight to the user.
  {
    kind: 'call',
    re: /(?:toast|confirm|alert|setError|setMsg|setNotice)\(\s*(?:'([^']{3,})'|"([^"]{3,})"|`([^`${}]{3,})`)/g,
  },
];

const results = [];
const wrappedResults = [];
for (const file of walk(ROOT)) {
  if (SKIP_PATH.has(relative(ROOT, file).replace(/\\/g, '/'))) continue;
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const hits = new Map(); // string -> line
  const wrapped = new Map(); // same, but found by the wrapped-JSX scan below (ratcheted)

  // A JSX text node that prettier wrapped onto its OWN line: the previous line ends the
  // opening tag, the next one starts the closing tag. The regex pass above cannot see it —
  // it requires `>text<` on a single line — and a browser pass found
  // "Halaman promo hanya untuk tim marketing." on /dashboard/promotions two hours after
  // this scanner had reported the whole app clean.
  const nonEmpty = (i, step) => {
    for (let k = i + step; k >= 0 && k < lines.length; k += step) {
      if (lines[k].trim()) return lines[k].trim();
    }
    return '';
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /[<>{}=;()?|&`]|^\/\/|^\*|^\/\*/.test(line)) continue;
    if (!nonEmpty(i, -1).endsWith('>') || !nonEmpty(i, 1).startsWith('<')) continue;
    if (isCode(line) || !ID_RE.test(line) || hits.has(line) || wrapped.has(line)) continue;
    wrapped.set(line, i + 1);
  }

  for (const { re } of PATTERNS) {
    for (const m of src.matchAll(re)) {
      const s = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
      if (!s || isCode(s) || !ID_RE.test(s)) continue;
      if (hits.has(s)) continue;
      hits.set(s, src.slice(0, m.index).split(/\r?\n/).length);
    }
  }
  // `// i18n-ok: why` on the line or the one above it. A few strings genuinely cannot be
  // translated at the point they are written — static route metadata, an Android channel
  // name the OS caches at creation — and an escape hatch that names its reason beats a
  // gate people learn to skip.
  // It covers the line it is on and the next four, so one comment can carry a whole small
  // object literal (`{ title, message, target }`) without repeating itself per property.
  for (const map of [hits, wrapped]) {
    for (const [s, line] of [...map]) {
      if (lines.slice(Math.max(0, line - 5), line).some((l) => /i18n-ok/.test(l))) map.delete(s);
    }
  }
  // A string that is only ever an argument to t() is already translated.
  for (const s of [...hits.keys()]) {
    if (lines[hits.get(s) - 1]?.includes(`t('`) && !lines[hits.get(s) - 1].includes(s)) hits.delete(s);
  }

  const file_ = relative(ROOT, file).replace(/\\/g, '/');
  if (hits.size) results.push({ file: file_, hits: [...hits.entries()] });
  if (wrapped.size) wrappedResults.push({ file: file_, hits: [...wrapped.entries()] });
}

// The capability matrix screen (/dashboard/roles) renders `t('dashC.roles.cap.' + cap)`
// for every capability in @hydromart/access. The map grew from 31 to 73 and the
// dictionary did not, so that screen printed 42 raw keys at the user in both locales —
// found by eye in the 2026-08-14 browser pass, invisible to tsc, tests and lint because
// the key is built at runtime. A computed key needs a check that walks the same source.
const capsSrc = readFileSync('packages/access/src/index.ts', 'utf8');
const capsBody = capsSrc.slice(capsSrc.indexOf('const CAPABILITIES'));
const caps = [...capsBody.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):\s*\[/gm)].map((m) => m[1]);
for (const locale of ['id', 'en']) {
  const dict = readFileSync(`${ROOT}/lib/dictionaries/${locale}/dashC.ts`, 'utf8');
  const block = dict.slice(dict.indexOf('cap: {'), dict.indexOf('cap: {') + 6000);
  const missing = caps.filter((c) => !new RegExp(`^ {6}${c}:`, 'm').test(block));
  if (missing.length)
    results.push({
      file: `lib/dictionaries/${locale}/dashC.ts`,
      hits: missing.map((c) => [`dashC.roles.cap.${c} has no ${locale} label`, 0]),
    });
}

// The wrapped-JSX scan found 144 strings the day it was written — real copy in 62 files,
// none of it ever counted by the "478 → 0" sweep. All 144 are translated now, so the
// baseline is ZERO and this is a plain gate again: a sentence long enough for prettier to
// wrap onto its own line is still copy, and it fails the build like any other.
const WRAPPED_BASELINE = 0;
const wrappedTotal = wrappedResults.reduce((n, r) => n + r.hits.length, 0);
if (wrappedTotal > WRAPPED_BASELINE) {
  console.error(
    `i18n ratchet FAILED: wrapped-JSX copy grew ${WRAPPED_BASELINE} → ${wrappedTotal}.\n` +
      'A sentence long enough for prettier to wrap onto its own line is still copy.\n',
  );
  for (const r of wrappedResults) {
    for (const [str, line] of r.hits) console.error(`  ${ROOT}/${r.file}:${line}  ${JSON.stringify(str)}`);
  }
  process.exit(1);
}

const total = results.reduce((n, r) => n + r.hits.length, 0);
if (total === 0) {
  console.log(
    `i18n check OK — no hardcoded Indonesian copy in ${ROOT}.` +
      (wrappedTotal < WRAPPED_BASELINE
        ? ` (wrapped-JSX debt ${wrappedTotal}/${WRAPPED_BASELINE} — lower the baseline in this script.)`
        : ` (wrapped-JSX debt: ${wrappedTotal}, run with --wrapped to list it.)`),
  );
  if (process.argv.includes('--wrapped')) {
    for (const r of wrappedResults) {
      for (const [str, line] of r.hits) console.log(`  ${ROOT}/${r.file}:${line}  ${JSON.stringify(str)}`);
    }
  }
  process.exit(0);
}

console.error(`i18n check FAILED: ${total} hardcoded Indonesian string(s) in ${results.length} file(s).`);
console.error('Wrap them with useT()/t(), or add the key to the dictionaries.\n');
for (const r of results) {
  for (const [s, line] of r.hits) console.error(`  ${ROOT}/${r.file}:${line}  ${JSON.stringify(s)}`);
}
process.exit(1);
