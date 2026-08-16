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
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'apps/web/src';

const ID_WORDS = [
  'yang',
  'dan',
  'atau',
  'tidak',
  'belum',
  'sudah',
  'akan',
  'ini',
  'itu',
  'untuk',
  'dari',
  'dengan',
  'pada',
  'per',
  'ada',
  'bisa',
  'harus',
  'wajib',
  'saja',
  'juga',
  'semua',
  'setiap',
  'lebih',
  'kurang',
  'baru',
  'lama',
  'hari',
  'bulan',
  'tahun',
  'minggu',
  'jam',
  'menit',
  'tanggal',
  'nama',
  'jumlah',
  'nilai',
  'harga',
  'biaya',
  'gaji',
  'karyawan',
  'pegawai',
  'depot',
  'pesanan',
  'pelanggan',
  'kurir',
  'stok',
  'galon',
  'poin',
  'simpan',
  'batal',
  'hapus',
  'ubah',
  'tambah',
  'cari',
  'pilih',
  'kirim',
  'muat',
  'lihat',
  'kembali',
  'lanjut',
  'selesai',
  'gagal',
  'berhasil',
  'kosong',
  'aktif',
  'nonaktif',
  'tersedia',
  'terpakai',
  'masuk',
  'keluar',
  'catatan',
  'keterangan',
  'jenis',
  'periode',
  'laporan',
  'ringkasan',
  'rincian',
  'daftar',
  'riwayat',
  'pengaturan',
  'dibuat',
  'diubah',
  'dihapus',
  'disetujui',
  'ditolak',
  'menunggu',
  'dibayar',
  'terlambat',
  'hadir',
  'absen',
  'cuti',
  'izin',
  'libur',
  'jabatan',
  'departemen',
  'atasan',
  'bawahan',
  'cabang',
  'pusat',
  'kantor',
  'opsional',
  'anda',
  'kamu',
  'sedang',
  'sedikit',
  'banyak',
  'antar',
  'pengiriman',
  'penjualan',
  'pembelian',
  'pembayaran',
  'setoran',
  'penarikan',
  'kasir',
  'gudang',
  'jadwal',
  'tugas',
  'lembur',
  'potongan',
  'tunjangan',
  'pinjaman',
  'hadiah',
  'langganan',
  'keranjang',
  'alamat',
  'akun',
  'sandi',
  'masalah',
  'bantuan',
  'ulasan',
  'penilaian',
  'target',
  'capaian',
  // Imperatives. The list started without them and missed a bare `>Setujui</Button>`.
  'setujui',
  'tolak',
  'kelola',
  'buat',
  'tutup',
  'cetak',
  'unduh',
  'ekspor',
  'impor',
  'ganti',
  'atur',
  'mulai',
  'ambil',
  'terima',
  'tunggu',
  'ulangi',
  'coba',
  'periksa',
];
const ID_RE = new RegExp(`(^|[^a-zA-Z])(${ID_WORDS.join('|')})([^a-zA-Z]|$)`, 'i');

/** Plainly not UI copy. */
function isCode(s) {
  if (!/[a-zA-Z]/.test(s)) return true;
  if (/^[A-Z0-9_]+$/.test(s)) return true; // enum member
  if (/^[a-z][a-zA-Z0-9]*$/.test(s)) return true; // identifier
  // `^\w+\/\w+` was meant to catch a mime type and also swallowed `Aktif/nonaktifkan`,
  // which is two Indonesian words with a slash between them. A mime type has no capital
  // letters and a known first token.
  if (/^https?:|^\/|^#/.test(s)) return true; // url / path / anchor
  if (/^(?:image|video|audio|text|application|font|model|multipart)\/[a-z0-9.+-]+$/.test(s))
    return true;
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

/** Replace comment bodies with spaces, keeping every newline and every offset. */
function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

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
  /*
   * A JSX text node with no interpolation.
   *
   * This used to carry `\n` in the negated set, which meant the text had to sit on the
   * SAME line as both tags. Prettier wraps any element whose line grows past the print
   * width, so the longer a hardcoded string was, the less likely this gate was to see
   * it — and several real ones were sitting behind exactly that. `<` `>` `{` `}` still
   * bound the match, so it cannot run past the end of one text node; the whitespace a
   * wrapped node carries is normalised away before the Indonesian-word test.
   */
  { kind: 'jsx', re: />([^<>{}]{3,})</g },
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
  /**
   * The four shapes a browser pass found copy hiding in, none of which the patterns above
   * could read. `/dashboard/subscriptions` printed a dictionary key and an Indonesian
   * template literal on the same two lines while this scanner reported the app clean.
   */
  // A template literal WITH interpolation: `berikutnya ${formatDateTime(x)}`. The `${…}`
  // holes are removed below and whatever prose is left is judged on its own.
  { kind: 'template', re: /`([^`\n]{3,})`/g },
  // `?? 'Depot kamu'` and `|| 'Manajer'` — a fallback the user reads when data is missing.
  { kind: 'fallback', re: /(?:\?\?|\|\|)\s*(?:'([^']{3,})'|"([^"]{3,})")/g },
  // A ternary whose branches are copy: `x ? 'Aktif' : 'Nonaktif'`.
  {
    kind: 'ternary',
    re: /\?\s*(?:'([^']{3,})'|"([^"]{3,})")\s*:\s*(?:'([^']{3,})'|"([^"]{3,})")/g,
  },
  // A bare array of strings used as options/labels.
  { kind: 'array', re: /\[\s*(?:'([^']{3,})'|"([^"]{3,})")\s*,/g },
  // Any object key at all, not the thirteen names listed above — `emptyTitle:`, `cta:`,
  // `body:` and friends were all invisible.
  {
    kind: 'anyKey',
    re: /(?:^|[{,[\s])[a-zA-Z][a-zA-Z0-9_]*\s*:\s*(?:'([^']{3,})'|"([^"]{3,})")/gm,
  },
];

let results = [];
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

  // Comments blanked, not removed: the new patterns below are broad enough to read prose
  // out of a doc block, and every byte has to keep its offset or the reported line number
  // points at the wrong place.
  const scannable = blankComments(src);
  for (const { re, kind } of PATTERNS) {
    for (const m of scannable.matchAll(re)) {
      let s = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
      // A template literal is judged on the prose between its holes, not on the
      // expressions inside them — `${formatDateTime(at)}` is code, "berikutnya" is copy.
      if (kind === 'template') s = s.replace(/\$\{[^{}]*\}/g, ' ').trim();
      // A wrapped JSX text node carries the indentation Prettier gave it. Collapse it, or
      // the same string reads differently depending on how deep in the tree it sits — and
      // the baseline could never match it twice running.
      if (kind === 'jsx') {
        s = s.replace(/\s+/g, ' ').trim();
        /*
         * `<` and `>` are comparison operators as well as tag delimiters, so once the
         * match may span lines it can start at a `>` in code and end at a `<` several
         * statements later. A statement separator or an assignment is the tell — no UI
         * string in this app contains one, and every false positive the widening produced
         * contained both.
         */
        if (/[;=]/.test(s)) continue;
        // Two more code shapes a widened match can straddle: a ternary or boolean chain
        // between two JSX branches, and a method call. Neither occurs in UI copy, while
        // parentheses and `&` on their own plainly do ("(opsional)", "utuh & tidak bocor").
        if (/\|\||&&|=>|\)\s*:|\?\s*\(/.test(s)) continue;
        if (/\w\.\w+\(/.test(s)) continue;
      }
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
    if (lines[hits.get(s) - 1]?.includes(`t('`) && !lines[hits.get(s) - 1].includes(s))
      hits.delete(s);
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
    for (const [str, line] of r.hits)
      console.error(`  ${ROOT}/${r.file}:${line}  ${JSON.stringify(str)}`);
  }
  process.exit(1);
}

/**
 * A recorded debt list, for the shapes this scanner learned to read AFTER the app had
 * already been written to them: interpolated template literals, `??` fallbacks, ternary
 * branches, bare string arrays and object keys outside the original thirteen names.
 *
 * Widening the patterns surfaced 80 strings in one run. 77 are translated. The three left
 * in `scripts/i18n-baseline.json` are NOT copy: they are the failure reasons stored on a
 * delivery record (`value:` in the courier's fail screen), and the file says so beside
 * them — the label above each one is translated, the stored value is deliberately stable.
 *
 * The list may SHRINK on its own and never grows: a string not in it fails the build, and
 * `--update-baseline` is a deliberate, reviewable act.
 */
const BASELINE_FILE = 'scripts/i18n-baseline.json';
const flat = results.flatMap((r) => r.hits.map(([str]) => `${r.file}	${str}`));
if (process.argv.includes('--update-baseline')) {
  writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify([...new Set(flat)].sort(), null, 2)}
`,
  );
  console.log(`Recorded ${new Set(flat).size} baselined string(s).`);
  process.exit(0);
}
const baseline = new Set(
  existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : [],
);
const stillOwed = new Set(flat.filter((f) => baseline.has(f)));
results = results
  .map((r) => ({ ...r, hits: r.hits.filter(([str]) => !baseline.has(`${r.file}	${str}`)) }))
  .filter((r) => r.hits.length);

const total = results.reduce((n, r) => n + r.hits.length, 0);
if (total === 0) {
  console.log(
    `i18n check OK — no hardcoded Indonesian copy in ${ROOT}.` +
      (stillOwed.size
        ? ` (${stillOwed.size} baselined string(s) still owed — see ${BASELINE_FILE}.)`
        : '') +
      (wrappedTotal < WRAPPED_BASELINE
        ? ` (wrapped-JSX debt ${wrappedTotal}/${WRAPPED_BASELINE} — lower the baseline in this script.)`
        : ` (wrapped-JSX debt: ${wrappedTotal}, run with --wrapped to list it.)`),
  );
  if (process.argv.includes('--wrapped')) {
    for (const r of wrappedResults) {
      for (const [str, line] of r.hits)
        console.log(`  ${ROOT}/${r.file}:${line}  ${JSON.stringify(str)}`);
    }
  }
  process.exit(0);
}

console.error(
  `i18n check FAILED: ${total} hardcoded Indonesian string(s) in ${results.length} file(s).`,
);
console.error('Wrap them with useT()/t(), or add the key to the dictionaries.\n');
for (const r of results) {
  for (const [s, line] of r.hits)
    console.error(`  ${ROOT}/${r.file}:${line}  ${JSON.stringify(s)}`);
}
process.exit(1);
