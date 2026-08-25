#!/usr/bin/env node
// Fails the build while the on-call rota in docs/RUNBOOK_ONCALL.md has no people in it (L1.6).
//
//   node scripts/check-oncall-rota.mjs [path/to/RUNBOOK_ONCALL.md]
//   node scripts/check-oncall-rota.mjs --self-test
//
// Why a gate and not a TODO: §3 of that runbook shipped with `_(isi)_` in every cell and
// nothing anywhere went red about it. An alerting stack with 16 rules, a webhook and a
// 4-hour repeat_interval was pointed at a rota with zero names — every page would have fired
// into a room and waited for nobody in particular. "PEMILIK: Anda" in prose is not a
// mechanism; this is.
//
// It is written against the failure class this repo keeps re-finding: a check that passes
// when its subject disappears. Deleting the rota table, deleting a role row you cannot
// staff, or replacing a placeholder with a space all go RED here, and --self-test proves
// each of those instead of asserting it in a comment.
//
// What it deliberately CANNOT do: tell a real person from a convincing invention. It rejects
// the obvious tells (placeholder words, sequential/repeated digits, example.com) and stops.
// A human who writes a plausible fake number defeats it, and no static check fixes that —
// what this closes is "we forgot", not "we lied".
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_PATH = 'docs/RUNBOOK_ONCALL.md';
const BEGIN = '<!-- ROTA:BEGIN';
const END = '<!-- ROTA:END';
// The section may be renumbered; its title is what the check hangs on. If BOTH the markers
// and this string are gone, the rota was not edited — it was removed, and that is a finding.
const SECTION_TITLE = 'Rotasi dan eskalasi';

// Three roles, because two of them are the escalation path and the third is the only one who
// knows whether a depot is simply closed (see NoOrdersCreated in ops/alert-rules.yml). A rota
// missing any of them is not a rota, so a row cannot be deleted to make this check pass.
const REQUIRED_ROLES = ['primer', 'sekunder', 'bisnis'];

const PLACEHOLDER_WORDS = new Set([
  'isi',
  'isinama',
  'isikontak',
  'isilah',
  'diisi',
  'belumdiisi',
  'tbd',
  'tba',
  'tbc',
  'todo',
  'fixme',
  'na',
  'nil',
  'none',
  'kosong',
  'nama',
  'namaanda',
  'kontak',
  'nomor',
  'telepon',
  'email',
  'anda',
  'placeholder',
  'dummy',
  'contoh',
  'sample',
  'example',
  'test',
  'testing',
  'foo',
  'bar',
  'baz',
  'xxx',
  'xx',
  'aaa',
  'seseorang',
  'siapa',
  'ganti',
]);

const FAKE_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'contoh.com',
  'test.com',
  'email.com',
  'domain.com',
  'localhost',
  'invalid',
  'mail.com',
]);

/** Strip markdown noise so `_(isi)_`, `**ISI-NAMA**` and `` `TBD` `` all normalise to one token. */
function bare(cell) {
  return cell
    .replace(/[*_`~]/g, '')
    .replace(/[()[\]{}]/g, '')
    .trim();
}

/** Letters+digits only, lowercased — what PLACEHOLDER_WORDS is compared against. */
function token(cell) {
  return bare(cell)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isPlaceholder(cell) {
  const t = token(cell);
  if (t === '') return true; // an empty or whitespace-only cell is the emptiest placeholder there is
  if (PLACEHOLDER_WORDS.has(t)) return true;
  // `ISI-NAMA` / `isi_kontak` / `(isi nama)` — any cell built out of a placeholder verb.
  if (/^(isi|ganti|todo|tbd|tba)/.test(t)) return true;
  if (/^x+$/.test(t) || /^-+$/.test(bare(cell))) return true;
  return false;
}

/** A name must look like a name. Mononyms are normal in Indonesia, so no two-word rule. */
function nameProblem(cell) {
  if (isPlaceholder(cell)) return 'masih placeholder';
  const v = bare(cell);
  const letters = v.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3) return `"${v}" bukan nama (kurang dari 3 huruf)`;
  if (new Set(letters.toLowerCase()).size < 2) return `"${v}" satu huruf yang diulang`;
  return null;
}

/**
 * A digit string a human typed to fill a box rather than to be called: all the same digit,
 * or a run of 6+ consecutive ascending/descending digits. This is what catches 081234567890
 * — the number every filled-in-to-shut-the-linter-up rota in the world has.
 */
function digitsLookInvented(digits) {
  if (new Set(digits).size <= 2) return true;
  let run = 1;
  for (let i = 1; i < digits.length; i += 1) {
    const step = Number(digits[i]) - Number(digits[i - 1]);
    run = step === 1 || step === -1 ? run + 1 : 1;
    if (run >= 6) return true;
  }
  return false;
}

/**
 * Two shapes only: an Indonesian phone number, or an email. A chat-group name is not a
 * contact — the group already receives the alerts, and that is the gap this document exists
 * to close.
 */
function contactProblem(cell) {
  if (isPlaceholder(cell)) return 'masih placeholder';
  const v = bare(cell);

  if (v.includes('@')) {
    const m = /^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/i.exec(v);
    if (!m) return `"${v}" bukan email yang sah`;
    if (FAKE_DOMAINS.has(m[2].toLowerCase())) return `"${v}" memakai domain contoh`;
    if (isPlaceholder(m[1])) return `"${v}" bagian depannya placeholder`;
    return null;
  }

  const compact = v.replace(/[\s\-.]/g, '');
  const m = /^(\+?62|0)(\d{8,13})$/.exec(compact);
  if (!m) return `"${v}" bukan nomor Indonesia (+62…/08…) maupun email`;
  if (digitsLookInvented(m[2])) return `"${v}" pola angkanya tebakan, bukan nomor`;
  return null;
}

/** "15 menit" / "2 jam" → minutes. Anything else is a promise nobody can be held to. */
function durationMinutes(cell) {
  const m = /^(\d+)\s*(menit|jam)$/i.exec(bare(cell));
  if (!m) return null;
  return Number(m[1]) * (m[2].toLowerCase() === 'jam' ? 60 : 1);
}

export function checkText(text) {
  const findings = [];
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);

  if (begin === -1 || end === -1 || end < begin) {
    findings.push(
      'penanda ROTA:BEGIN/ROTA:END tidak ditemukan — seksi rota dihapus atau penandanya dibuang. ' +
        'Pemeriksaan ini tidak boleh hijau ketika subjeknya hilang.',
    );
    if (!text.includes(SECTION_TITLE)) {
      findings.push(`seksi "${SECTION_TITLE}" juga tidak ada di dokumen`);
    }
    return findings;
  }
  if (!text.includes(SECTION_TITLE)) {
    findings.push(
      `penanda rota ada tapi seksi "${SECTION_TITLE}" hilang — tabelnya dipindah ke tempat lain`,
    );
  }

  const rows = text
    .slice(begin, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim()),
    )
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)))
    .filter((cells) => token(cells[0]) !== 'peran');

  if (rows.length === 0) {
    findings.push('tidak ada satu baris rota pun di antara penanda — tabelnya dikosongkan');
    return findings;
  }

  const byRole = new Map();
  for (const cells of rows) {
    const label = bare(cells[0]) || '(tanpa peran)';
    if (cells.length < 5) {
      findings.push(
        `baris "${label}" tidak punya 5 kolom (Peran|Nama|Kontak|Jam|Janji waktu jawab)`,
      );
      continue;
    }
    const [role, name, contact, hours, promise] = cells;

    const nm = nameProblem(name);
    if (nm) findings.push(`baris "${label}": kolom Nama ${nm}`);
    const ct = contactProblem(contact);
    if (ct) findings.push(`baris "${label}": kolom Kontak ${ct}`);
    if (isPlaceholder(hours)) findings.push(`baris "${label}": kolom Jam masih placeholder`);
    const mins = durationMinutes(promise);
    if (mins === null) {
      findings.push(
        `baris "${label}": kolom Janji waktu jawab "${bare(promise)}" bukan durasi (contoh: "15 menit", "2 jam")`,
      );
    }

    const key = REQUIRED_ROLES.find((r) => token(role).startsWith(r));
    // `name` is carried forward only when it is a real name: with placeholders in every row
    // the same-person cross-check below would otherwise fire on ISI-NAMA == ISI-NAMA and add
    // a seventh finding that tells the reader nothing they were not already told.
    if (key) byRole.set(key, { label, name: nm ? '' : token(name), minutes: mins });
  }

  for (const role of REQUIRED_ROLES) {
    if (!byRole.has(role))
      findings.push(`peran "${role}" tidak ada di rota — barisnya dihapus, bukan diisi`);
  }

  const primer = byRole.get('primer');
  const sekunder = byRole.get('sekunder');
  if (primer && sekunder) {
    // An escalation path whose two ends are the same phone is not an escalation path.
    if (primer.name && primer.name === sekunder.name) {
      findings.push(
        'primer dan sekunder orangnya sama — tidak ada eskalasi, hanya satu orang ditulis dua kali',
      );
    }
    // §3 promises the secondary is woken when the primary goes quiet. If the primary is
    // allowed longer than the secondary, the table contradicts its own escalation rule.
    if (primer.minutes !== null && sekunder.minutes !== null && primer.minutes > sekunder.minutes) {
      findings.push(
        `janji primer (${primer.minutes} menit) lebih lama dari sekunder (${sekunder.minutes} menit) — ` +
          'eskalasinya jadi mustahil',
      );
    }
  }

  return findings;
}

function runFile(path, verbose = false) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    if (verbose)
      console.error(
        `check-oncall-rota: tidak bisa membaca ${path} — rota on-call tidak ada di repo ini.`,
      );
    return 1;
  }
  const findings = checkText(text);
  if (findings.length === 0) {
    if (verbose) console.log(`check-oncall-rota: rota di ${path} berisi orang, bukan placeholder.`);
    return 0;
  }
  if (verbose) {
    console.error(`check-oncall-rota: ${findings.length} masalah di ${path}\n`);
    for (const f of findings) console.error(`  - ${f}`);
    console.error(
      '\nRota tanpa nama = alert yang menyala ke ruangan tanpa penanggung jawab. Isi seksi ' +
        `"${SECTION_TITLE}" di ${DEFAULT_PATH} lalu commit; tidak ada default yang jujur untuk kolom-kolom itu.`,
    );
  }
  return 1;
}

// --- self-check ------------------------------------------------------------------------
// Same intent as scripts/*.test.sh: prove the gate can be RED, and red for the right row.
// Fixtures are synthetic on purpose — asserting anything about the real runbook would break
// the day a human finally fills it in, which is the day this gate is supposed to go green.
function doc({ rows, markers = true, title = true } = {}) {
  const body = [
    '| Peran | Nama | Kontak | Jam | Janji waktu jawab |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
  return [
    title ? `## 3. ${SECTION_TITLE} — PEMILIK: Anda` : '## 3. Sesuatu yang lain',
    '',
    markers ? `${BEGIN} -->` : '',
    body,
    markers ? `${END} -->` : '',
  ].join('\n');
}

// Fixture people only. Random-looking digits so digitsLookInvented() does not fire on them;
// they exist to exercise the PASS branch and are never presented as a real rota.
const FILLED = [
  '| Primer | Ari Nugroho | +62 811 2003 4417 | 24/7 | 15 menit |',
  '| Sekunder | Dwi Lestari | dwi.lestari@hydromart.id | eskalasi ketika primer diam | 30 menit |',
  '| Bisnis (depot/keuangan) | Rahmat Hidayat | 0817 4429 6053 | jam kerja 09:00-20:00 WIB | 2 jam |',
];

function selfTest() {
  let fails = 0;
  const cases = [
    ['rota terisi lolos', doc({ rows: FILLED }), null],
    [
      'placeholder ISI-NAMA ditolak',
      doc({ rows: ['| Primer | ISI-NAMA | ISI-KONTAK | 24/7 | 15 menit |', ...FILLED.slice(1)] }),
      'Primer',
    ],
    [
      'placeholder _(isi)_ lama ditolak',
      doc({ rows: ['| Primer | _(isi)_ | _(isi)_ | 24/7 | 15 menit |', ...FILLED.slice(1)] }),
      'placeholder',
    ],
    [
      'spasi saja tidak cukup',
      doc({ rows: ['| Primer |    |    | 24/7 | 15 menit |', ...FILLED.slice(1)] }),
      'Primer',
    ],
    [
      'nomor tebakan ditolak',
      doc({
        rows: ['| Primer | Ari Nugroho | 081234567890 | 24/7 | 15 menit |', ...FILLED.slice(1)],
      }),
      'tebakan',
    ],
    [
      'domain contoh ditolak',
      doc({
        rows: ['| Primer | Ari Nugroho | ari@example.com | 24/7 | 15 menit |', ...FILLED.slice(1)],
      }),
      'domain contoh',
    ],
    [
      'nama grup chat bukan kontak',
      doc({ rows: ['| Primer | Ari Nugroho | grup ops | 24/7 | 15 menit |', ...FILLED.slice(1)] }),
      'bukan nomor Indonesia',
    ],
    ['baris peran dihapus tetap merah', doc({ rows: FILLED.slice(0, 2) }), 'peran "bisnis"'],
    [
      'janji bukan durasi ditolak',
      doc({
        rows: [
          '| Primer | Ari Nugroho | +62 811 2003 4417 | 24/7 | secepatnya |',
          ...FILLED.slice(1),
        ],
      }),
      'bukan durasi',
    ],
    [
      'janji primer > sekunder ditolak',
      doc({
        rows: ['| Primer | Ari Nugroho | +62 811 2003 4417 | 24/7 | 2 jam |', ...FILLED.slice(1)],
      }),
      'mustahil',
    ],
    [
      'primer = sekunder ditolak',
      doc({
        rows: [
          FILLED[0],
          '| Sekunder | Ari Nugroho | dwi.lestari@hydromart.id | eskalasi | 30 menit |',
          FILLED[2],
        ],
      }),
      'orangnya sama',
    ],
    [
      'kolom dipotong ditolak',
      doc({ rows: ['| Primer | Ari Nugroho | +62 811 2003 4417 |', ...FILLED.slice(1)] }),
      '5 kolom',
    ],
    ['penanda dihapus tetap merah', doc({ rows: FILLED, markers: false }), 'seksi rota dihapus'],
    ['tabel dikosongkan tetap merah', doc({ rows: [] }), 'dikosongkan'],
    ['seksi dipindah tetap merah', doc({ rows: FILLED, title: false }), 'hilang'],
  ];

  for (const [label, text, expect] of cases) {
    const findings = checkText(text);
    const ok = expect === null ? findings.length === 0 : findings.some((f) => f.includes(expect));
    if (ok) {
      console.log(`ok   ${label}`);
    } else {
      console.log(`FAIL ${label} — dapat: ${findings.length ? findings.join(' / ') : '(hijau)'}`);
      fails += 1;
    }
  }

  // The path plumbing too: a missing file must be a finding, not a crash, or a renamed
  // runbook would silently pass in CI.
  const dir = mkdtempSync(join(tmpdir(), 'oncall-rota-'));
  if (runFile(join(dir, 'nope.md')) === 1) console.log('ok   dokumen hilang dilaporkan');
  else {
    console.log('FAIL dokumen hilang tidak dilaporkan');
    fails += 1;
  }

  const good = join(dir, 'ok.md');
  writeFileSync(good, doc({ rows: FILLED }));
  if (runFile(good) === 0) console.log('ok   dokumen terisi lolos lewat path');
  else {
    console.log('FAIL dokumen terisi gagal lewat path');
    fails += 1;
  }

  return fails;
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    const fails = selfTest();
    console.log(fails === 0 ? '\nself-test: semua lolos' : `\nself-test: ${fails} gagal`);
    process.exit(fails === 0 ? 0 : 1);
  }
  process.exit(runFile(process.argv[2] || DEFAULT_PATH, true));
}
