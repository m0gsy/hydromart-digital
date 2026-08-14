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
for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const hits = new Map(); // string -> line

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
  for (const [s, line] of [...hits]) {
    if (lines.slice(Math.max(0, line - 5), line).some((l) => /i18n-ok/.test(l))) hits.delete(s);
  }
  // A string that is only ever an argument to t() is already translated.
  for (const s of [...hits.keys()]) {
    if (lines[hits.get(s) - 1]?.includes(`t('`) && !lines[hits.get(s) - 1].includes(s)) hits.delete(s);
  }

  if (hits.size)
    results.push({ file: relative(ROOT, file).replace(/\\/g, '/'), hits: [...hits.entries()] });
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

const total = results.reduce((n, r) => n + r.hits.length, 0);
if (total === 0) {
  console.log(`i18n check OK — no hardcoded Indonesian copy in ${ROOT}.`);
  process.exit(0);
}

console.error(`i18n check FAILED: ${total} hardcoded Indonesian string(s) in ${results.length} file(s).`);
console.error('Wrap them with useT()/t(), or add the key to the dictionaries.\n');
for (const r of results) {
  for (const [s, line] of r.hits) console.error(`  ${ROOT}/${r.file}:${line}  ${JSON.stringify(s)}`);
}
process.exit(1);
