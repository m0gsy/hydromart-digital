#!/usr/bin/env node
/**
 * Keyboard and screen-reader debt in apps/web, as a gate.
 *
 * The console audit (§12 CA-1-53, §25 CA-2-38, §28 CA-2-68) reported four shapes of it, and
 * all four were real when this was written:
 *
 *  1. Three screens hid an `<input type="file">` with `display:none` and drew a `<span>` or
 *     a `<label>` in its place. `display:none` takes an element out of the tab order, and
 *     neither of those was ever in it, so on every bulk-import screen the ONLY way to pick a
 *     file was a mouse. `sr-only` hides it just as completely and keeps the tab stop.
 *  2. Two tables navigated on a row `onClick` and nothing else. A `<tr>` has no tab stop, so
 *     those rows opened for a mouse and for nobody else.
 *  3. Thirty-six forms rendered their failure as a bare `<p>`. A message that appears after
 *     a button press with no live region is announced to nobody: the submit reads as having
 *     quietly done nothing.
 *  4. Fourteen native form controls with no accessible name at all — no `aria-label`, no
 *     `id` for a `<label htmlFor>` to point at, no `<label>` or `<Field>` around them. A
 *     screen reader announces "combo box" and the person guesses.
 *
 * A finding is a defect, not a style note, so the budget for each rule is ZERO — the same
 * shape `no-native-dialogs.test.ts` uses, and unlike `check-depot-scope.mjs` there is no
 * baseline to ratchet down because there is nothing here that is deliberate.
 *
 *   node scripts/check-a11y.mjs      # gate: exit 1 on any finding
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from THIS file, not from the cwd: the gate runs from the repo root and the
// vitest suite that imports it runs from apps/web.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'src');
const LABEL = 'apps/web/src';
const SKIP_DIR = new Set(['node_modules', '__tests__', '__mocks__', 'dictionaries']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(p, out);
    } else if (/\.tsx$/.test(p) && !/\.(test|spec)\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Replace comment bodies with spaces, keeping every newline and every offset.
 *
 * `accept="image/*"` is an attribute value, not the start of a block comment — and the
 * first version of this blanked from there to the next comment close several hundred lines
 * away, swallowing the very `<input>` it was about to check. So comment openers inside an
 * `attr="…"` value are blanked to spaces of the same length FIRST. They are not restored
 * and need not be: no rule below reads the inside of a value that could hold one.
 */
export function blankComments(src) {
  return src
    .replace(/=\s*(['"])[^'"\n]*\1/g, (v) =>
      v.replace(/\/\*|\*\/|\/\//g, (m) => ' '.repeat(m.length)),
    )
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

/**
 * The attribute text of the JSX tag that opens at `start`.
 *
 * A regex cannot do this. `onChange={(e) => setX(e.target.value)}` contains a `>`, so
 * `<select[^>]*>` stops in the middle of the handler and every attribute after it — the
 * `aria-label` among them — reads as absent. The first attempt at this check reported 38
 * nameless controls and 30 of them already had a name. So: walk the characters, and only
 * let a `>` close the tag at brace depth zero and outside a string.
 */
export function tagAttrs(src, start) {
  let depth = 0;
  let quote = '';
  for (let i = src.indexOf(' ', start); i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, i);
    else if (c === '<' && depth === 0) return src.slice(start, i); // unterminated — bail
  }
  return src.slice(start);
}

/** 1-based line of a source offset. */
const lineAt = (src, index) => src.slice(0, index).split(/\r?\n/).length;

/**
 * Is the element at `start` inside a `<label>` or a `<Field>`?
 *
 * `<Field>` puts its generated id on its single child and points its own `<label htmlFor>`
 * at it (components/ui.tsx), so a control inside one is named by construction.
 */
function insideNamingWrapper(src, start) {
  const before = src.slice(0, start);
  for (const tag of ['label', 'Field']) {
    const open = before.lastIndexOf(`<${tag}`);
    if (open === -1) continue;
    if (!before.slice(open).includes(`</${tag}>`)) return true;
  }
  return false;
}

const RULES = {
  /** 1 — a file picker nobody can tab to. */
  filePicker(src, rel, add) {
    for (const m of src.matchAll(/<input\b/g)) {
      const attrs = tagAttrs(src, m.index);
      if (!/type\s*=\s*["']file["']/.test(attrs)) continue;
      // A `hidden` input driven by a real <button> through a ref keeps its keyboard path:
      // the button is the tab stop. One hidden with nothing pointing at it has none.
      if (/\bref\s*=/.test(attrs)) continue;
      if (/\bhidden\b/.test(attrs))
        add('filePicker', rel, lineAt(src, m.index), 'input type="file" hidden, no ref, no tab stop');
    }
  },

  /** 2 — a table row that only a mouse can open. */
  clickableRow(src, rel, add) {
    for (const m of src.matchAll(/<tr\b/g)) {
      const attrs = tagAttrs(src, m.index);
      if (!/\bonClick\s*=/.test(attrs)) continue;
      if (/\bonKeyDown\s*=/.test(attrs)) continue;
      const end = src.indexOf('</tr>', m.index);
      const body = src.slice(m.index, end === -1 ? src.length : end);
      if (/<Link\b/.test(body)) continue;
      add('clickableRow', rel, lineAt(src, m.index), '<tr onClick> with no link and no key handler');
    }
  },

  /** 3 — a failure message with no live region. */
  errorLiveRegion(src, rel, add) {
    // The identifier prefix is optional on purpose. The first draft required one, so it
    // matched `saveError` and `geoError` and missed the twenty-seven sites that simply say
    // `{error && <p …>}` — the most common shape of the defect went unreported.
    for (const m of src.matchAll(/\{\s*[A-Za-z0-9_.]*?(?:[Ee]rror|[Mm]sg)\s*&&\s*\(?\s*<p\b/g)) {
      const end = src.indexOf('</p>', m.index);
      const body = src.slice(m.index, end === -1 ? m.index : end);
      if (/role\s*=\s*["'](alert|status)["']|aria-live/.test(body)) continue;
      add(
        'errorLiveRegion',
        rel,
        lineAt(src, m.index),
        'error rendered without role="alert" — use <FormError>',
      );
    }
  },

  /** 4 — a control a screen reader cannot name. */
  controlName(src, rel, add) {
    for (const m of src.matchAll(/<(select|textarea|input)\b/g)) {
      const attrs = tagAttrs(src, m.index);
      if (/\baria-label(?:ledby)?\s*=|\bid\s*=|\{\.\.\.rest\}|\{\.\.\.props\}/.test(attrs)) continue;
      // A hidden or submit input renders no control to name; a file input is rule 1's.
      if (/type\s*=\s*["'](hidden|submit|file)["']/.test(attrs)) continue;
      if (insideNamingWrapper(src, m.index)) continue;
      add('controlName', rel, lineAt(src, m.index), `<${m[1]}> with no accessible name`);
    }
  },
};

/** Every finding in `apps/web/src`, so a test can assert on the same walk CI runs. */
export function scan() {
  const findings = [];
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const src = blankComments(readFileSync(file, 'utf8'));
    const add = (rule, f, line, why) => findings.push({ rule, file: f, line, why });
    for (const run of Object.values(RULES)) run(src, rel, add);
  }
  return findings;
}

/** Run the same four rules over one snippet — what the test uses to prove they can fire. */
export function scanSource(text) {
  const findings = [];
  const src = blankComments(text);
  const add = (rule, f, line, why) => findings.push({ rule, file: f, line, why });
  for (const run of Object.values(RULES)) run(src, '<snippet>', add);
  return findings;
}

// `import.meta.main` is not in Node 22; comparing argv[1] is, and the test imports this
// file without wanting it to call process.exit().
if (process.argv[1] && process.argv[1].endsWith('check-a11y.mjs')) {
  const findings = scan();
  if (findings.length === 0) {
    console.log(`a11y check OK — no keyboard or naming debt in ${LABEL}.`);
    process.exit(0);
  }
  console.error(`a11y check FAILED: ${findings.length} finding(s).`);
  for (const f of findings) console.error(`  [${f.rule}] ${LABEL}/${f.file}:${f.line}  ${f.why}`);
  process.exit(1);
}
