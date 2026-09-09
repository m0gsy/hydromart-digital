import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Fourteen hardcoded Indonesian strings the i18n gate could not see.
 *
 * They were found by widening the gate's Indonesian word list — which was 151 words, and
 * measured against the app's OWN Indonesian dictionaries (5,250 sentences that are
 * Indonesian by definition) failed to recognise 29.6% of them.
 *
 * The widening itself is NOT in this change: clearing these fourteen surfaced ~30 more,
 * mixed with false positives the wider list creates (`function Harian(`, a filename
 * template, sentence fragments). Landing it needs those thirty fixes AND pattern tightening,
 * as one deliberate pass — CA-2-48 records the measurement and stays open.
 *
 * These fourteen are real either way, so they are fixed either way. This test is what stops
 * them coming back while the gate still cannot see them.
 */

const SITES: [file: string, wasHardcoded: string][] = [
  ['src/app/dashboard/customers/detail/page.tsx', 'Diunggah saat pendaftaran reseller.'],
  ['src/app/dashboard/vouchers/page.tsx', 'Nonaktifkan'],
  ['src/app/favorites/page.tsx', 'Jelajahi produk'],
  ['src/app/hr/assets/page.tsx', 'Catat Pergerakan'],
  ['src/app/hr/departments/page.tsx', 'Kode'],
  ['src/app/hr/reports/page.tsx', 'Sampai'],
  ['src/app/m/manager/login/page.tsx', 'Nomor HP terdaftar'],
  ['src/components/biometric-retry.tsx', 'Buka sesi tersimpan'],
  ['src/components/dashboard/cashier-shift-bar.tsx', 'Buka shift'],
  ['src/components/dashboard/ops-bottom-nav.tsx', 'Lainnya'],
  ['src/components/native-bridge.tsx', 'Buka Play Store'],
  ['src/app/driver/deliveries/detail/page.tsx', 'Telepon'],
  ['src/app/m/manager/account/page.tsx', 'Buka di desktop'],
  ['src/app/m/manager/account/page.tsx', 'Hydromart Manajer · v1.0.0'],
];

/** JSX text nodes only — a comment mentioning a phrase is prose, not rendered copy. */
const rendered = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the fourteen strings the gate walked past', () => {
  it.each(SITES)('%s no longer renders %j', (file, text) => {
    // A JSX text node: newline, whitespace, the sentence, whitespace, newline. Matching the
    // bare substring would flag the dictionary VALUE and every comment that quotes it.
    const escaped = [...text].map((c) => (/[a-zA-Z0-9]/.test(c) || c === ' ' ? c : '\\' + c)).join('');
    const asTextNode = new RegExp('\\n\\s*' + escaped + '\\s*\\n');
    expect(rendered(file)).not.toMatch(asTextNode);
  });

  it('translates the Play Store screen WITHOUT a hook — it renders outside the providers', () => {
    /*
     * The first version of this fix reached for `useT`, and the existing native-bridge tests
     * caught it: `app/layout.tsx` mounts <NativeBridge/> ABOVE ThemeProvider and
     * LocaleProvider on purpose — "its WebView-too-old screen has to render even if
     * everything below it is failing" — and `useT` throws outside its provider. The hook
     * would have crashed the one screen whose whole job is surviving a crash.
     *
     * `translate` is the same resolver, without the context requirement; `lib/api.ts` uses
     * it for the same reason.
     */
    const src = rendered('src/components/native-bridge.tsx');
    expect(src).toContain("translate('hrFix.nativeBridge.openPlayStore')");
    expect(src).not.toContain('useT(');
  });
});
