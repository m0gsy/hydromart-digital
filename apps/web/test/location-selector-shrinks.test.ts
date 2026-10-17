import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * At 320dp the app bar has 320 - 32 (padding) = 288px for the location chip, the bell and the
 * cart. The bell and cart are 44px each plus a gap (94px), which leaves the chip ~186px — but
 * the button was 8 + 18 + 6 + 160 (label max) + 6 + 14 + 8 = 220px and could not shrink, so the
 * home page of the signed-in customer scrolled 6px sideways inside the APK (measured in the
 * WebView at 320dp: the cart button's right edge at 326px).
 *
 * A flex child only shrinks below its content when it opts in with `min-w-0`; the label then
 * truncates instead of pushing the cart off the screen.
 */
const source = readFileSync(join(__dirname, '../src/components/location-selector.tsx'), 'utf8');

describe('location chip in the app bar', () => {
  it('lets the root shrink so the label can truncate instead of overflowing the row', () => {
    expect(source).toMatch(/<div className="relative min-w-0" ref=\{rootRef\}>/);
  });

  it('lets the button and its label shrink too', () => {
    expect(source).toMatch(/'flex min-w-0 max-w-full items-center gap-1\.5 rounded-lg px-2 py-1/);
    expect(source).toMatch(/<span className="min-w-0 max-w-\[10rem\] truncate">/);
  });
});
