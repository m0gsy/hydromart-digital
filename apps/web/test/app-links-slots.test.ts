import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * J3. The App Links claim list is spread across three files that cannot see each other,
 * and the failure mode is silent in the worst way: gradle ignores a `-P` property nothing
 * declares, the manifest merger ignores a placeholder nothing supplies, and Android just
 * declines to verify. Nothing goes red anywhere — the link opens in a browser, which is
 * also what it does when everything is fine but the domain is wrong.
 *
 * `mobile.yml` does not run on pull_request either (it holds the keystore and takes twenty
 * minutes), so a slot added to the workflow and not to the manifest would ship unnoticed
 * until somebody tapped a link on a real phone. This test is the only thing between those
 * two facts.
 */

const ROOT = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

const MANIFEST = read('mobile/android/app/src/main/AndroidManifest.xml');
const GRADLE = read('mobile/android/app/build.gradle');
const WORKFLOW = read('.github/workflows/mobile.yml');

/** Highest N in `linkPrefixN` / `hydromartLinkPrefixN` across a file. `linkPrefix` is 1. */
function highestSlot(source: string, prefix: string): number {
  const numbers = [...source.matchAll(new RegExp(`${prefix}(\\d*)\\b`, 'g'))].map((m) =>
    m[1] ? Number(m[1]) : 1,
  );
  return Math.max(0, ...numbers);
}

describe('J3 · every claimed path prefix has a slot to arrive in', () => {
  it('the manifest declares as many placeholders as gradle supplies', () => {
    expect(highestSlot(MANIFEST, 'linkPrefix')).toBe(highestSlot(GRADLE, 'hydromartLinkPrefix'));
  });

  it('the workflow never passes a slot beyond what the manifest declares', () => {
    // A `-PhydromartLinkPrefix21=/x` with only twenty slots is accepted by gradle, dropped
    // by the merger, and reported by nobody.
    expect(highestSlot(WORKFLOW, 'hydromartLinkPrefix')).toBeLessThanOrEqual(
      highestSlot(MANIFEST, 'linkPrefix'),
    );
  });

  it('claims the home page by exact path, never by prefix', () => {
    // `pathPrefix="/"` claims the whole site — including `/driver` and `/m`, which puts two
    // verified apps on one link and makes Android ask the user every time.
    expect(MANIFEST).toContain('android:path="${linkExact}"');
    expect(MANIFEST).not.toContain('android:pathPrefix="/"');
    expect(GRADLE).toContain('linkExact: hydromartLinkExact');
  });

  it('the customer build claims the surfaces J3 named', () => {
    for (const path of [
      '/notifications',
      '/addresses',
      '/favorites',
      '/login',
      '/register',
      '/kebijakan-privasi',
      '/hapus-akun',
    ]) {
      expect(WORKFLOW, path).toContain(`=${path} `);
    }
    expect(WORKFLOW).toContain('-PhydromartLinkExact=/');
  });
});
