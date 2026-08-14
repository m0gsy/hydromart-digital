import { describe, expect, it } from 'vitest';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { en } from '@/lib/dictionaries/en';
import { id } from '@/lib/dictionaries/id';

/**
 * `t()` falls back to the key when a lookup misses, so a typo or a key that was never added
 * ships as literal `common.error` text on the screen — green typecheck, green lint, nothing
 * to see until someone hits that state. Two of those were live when this was written.
 *
 * Every `t('…')` literal in the app is resolved against the real dictionaries here.
 */
const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'dictionaries' ? [] : walk(path);
    return /\.tsx?$/.test(e.name) ? [path] : [];
  });
}

function lookup(dict: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), dict);
}

/** Comments are stripped first: a doc block that shows `t('rewards.toNext', …)` as an
 *  example is not a call site, and treating it as one is a failing test with no bug. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const used = new Map<string, string>();
for (const file of walk(SRC)) {
  const src = code(readFileSync(file, 'utf8'));
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
    const key = m[1] ?? '';
    if (key && !used.has(key)) used.set(key, file);
  }
}

describe('locale keys', () => {
  it('finds every key the app asks for, in every locale', () => {
    // Dynamic keys (`t(\`x.${y}\`)`) are template literals and are not collected here, so
    // this is a floor, not a ceiling — it is the misspelled-constant case it catches.
    expect(used.size).toBeGreaterThan(500);

    const missing: string[] = [];
    for (const [key, file] of used) {
      for (const [locale, dict] of Object.entries({ id, en })) {
        if (typeof lookup(dict, key) !== 'string') {
          missing.push(`${locale}: ${key} (${file.slice(file.indexOf('src'))})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

/**
 * The app-bar title of every pushed screen is a dictionary key held in a map, which is a
 * shape the scanner above does not read — and `/referral` shipped with
 * `profile.referral.title` when the key lives at `profile.rewards.referral.title`. The
 * app bar printed the key itself, in both locales, on a screen in the customer binary.
 */
describe('screen-chrome titles resolve', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'screen-chrome.ts'), 'utf8');
  const keys = [...src.matchAll(/'(\/[^']*)':\s*'([a-z][A-Za-z0-9_.]+)'/g)].map((m) => ({
    route: m[1] as string,
    key: m[2] as string,
  }));

  it('finds the title map at all', () => {
    expect(keys.length).toBeGreaterThan(8);
  });

  it.each(keys)('$route → $key exists in both dictionaries', ({ key }) => {
    expect(typeof lookup(id, key)).toBe('string');
    expect(typeof lookup(en, key)).toBe('string');
  });
});

/**
 * id↔en key parity, which nothing enforced. It happens to be clean today (5,276 = 5,276),
 * so this gate is born at zero — which is the only moment adding it is free. A key present
 * in one dictionary and absent from the other is invisible until somebody switches locale
 * and reads the key itself off the screen.
 */
describe('dictionary parity', () => {
  function flatten(dict: unknown, prefix = '', out: string[] = []): string[] {
    if (dict && typeof dict === 'object') {
      for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object') flatten(v, path, out);
        else out.push(path);
      }
    }
    return out;
  }

  const idKeys = new Set(flatten(id));
  const enKeys = new Set(flatten(en));

  it('has no key that exists in one locale and not the other', () => {
    const missingInEn = [...idKeys].filter((k) => !enKeys.has(k));
    const missingInId = [...enKeys].filter((k) => !idKeys.has(k));
    expect({ missingInEn, missingInId }).toEqual({ missingInEn: [], missingInId: [] });
  });

  it('counts the same number of leaves on both sides', () => {
    expect(enKeys.size).toBe(idKeys.size);
  });
});
