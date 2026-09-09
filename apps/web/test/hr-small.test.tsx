// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Three small HR defects, each of which the surrounding code already knew how to avoid.
 *
 *  - CA-1-58: `border-ty` is not a Tailwind class. Three dividers matched nothing and drew
 *    nothing — and nothing errors on an unknown utility class, so the page simply looked
 *    slightly wrong forever.
 *  - CA-1-71: two import screens validate a spreadsheet column AGAINST the depot list, and
 *    neither reported it when that list failed to load. Every row is then rejected with
 *    "kode depot tidak dikenal", which reads as a bad file — so the operator fixes a
 *    spreadsheet that was right all along. Departments and shifts on the same page have
 *    reported their own failures since they were written.
 *  - CA-1-66: the face-match score was on the record and on no screen.
 */

const code = (f: string) =>
  readFileSync(f, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('CA-1-58 a divider that actually draws', () => {
  it('uses no class Tailwind does not define', () => {
    const src = code('src/app/hr/assets/page.tsx');
    expect(src).not.toContain('border-ty');
    // Three of them, all meaning "a rule above this block".
    expect(src.match(/border-t border-app/g)?.length).toBe(3);
  });
});

describe('CA-1-71 an unread depot list is reported, not blamed on the file', () => {
  it('reports it on both screens that validate against it', () => {
    for (const f of [
      'src/app/hr/employees/import/page.tsx',
      'src/app/hr/assets/import/page.tsx',
    ]) {
      const src = code(f);
      // The list is read for validation…
      expect(src).toMatch(/depots\.(find|map)/);
      /*
       * …so its failure has to REACH THE SCREEN. Asserting the identifier merely exists is
       * what the first version of this test did, and it stayed green through a revert that
       * left the destructuring in place and dropped the render — the same weakness as
       * checking a button's label instead of what it sends.
       */
      expect(src).toMatch(/\{[^}]*depotsError[^}]*&&[\s\S]{0,200}LoadError/);
      expect(src).toMatch(/depotsError\)\s*reloadDepots\(\)|onRetry=\{reloadDepots\}/);
    }
  });

  it('leaves the four scope-selector screens alone', () => {
    // Measurement, not assumption: these use `useDepot` for a selector, where an empty list
    // is visible on its face. Adding an error banner there would be noise, not truth.
    for (const f of [
      'src/app/dashboard/customers/import/page.tsx',
      'src/app/dashboard/inventory/import/page.tsx',
      'src/app/dashboard/pricing/import/page.tsx',
      'src/app/dashboard/resellers/import/page.tsx',
    ]) {
      expect(code(f)).not.toMatch(/depots\.(find|some)\(/);
    }
  });
});

describe('CA-1-66 the face-match score reaches the person deciding', () => {
  it('shows a percentage, and an em dash when nothing was measured', () => {
    const src = code('src/app/hr/attendance/page.tsx');
    // Null is not zero: null means matching was off or never ran, which is not a photo that
    // scored badly. Rendering 0% for it would accuse somebody of something that never
    // happened.
    expect(src).toContain('a.checkInScore == null');
    expect(src).toContain('Math.round(a.checkInScore * 100)');
    expect(src).not.toMatch(/checkInScore \?\? 0/);
    // The threshold is a DISPLAY hint; the server owns whether a punch is accepted.
    expect(src).toContain('FACE_SCORE_SUSPECT');
  });
});
