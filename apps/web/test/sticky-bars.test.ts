import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A sticky action bar has two breakpoints and they must agree: the width it stops being
 * sticky at (`unstickAt`) and the width it stops being rendered at (`lg:hidden`, when the
 * screen has one). They disagreed on `/cart` — the bar went static at 640px while it was
 * still the only total on screen until 1024, so a long cart on a tablet had neither a
 * pinned total nor the summary rail that replaces it.
 *
 * Read from source rather than rendered: what is being asserted is the pairing a reviewer
 * has to notice, and it lives in the call site, not in the DOM of any one width.
 */
const CONSUMERS = [
  'src/app/cart/page.tsx',
  'src/app/checkout/page.tsx',
  'src/app/orders/detail/page.tsx',
  'src/app/products/detail/page.tsx',
];

const root = join(__dirname, '..');

describe('sticky action bars', () => {
  it.each(CONSUMERS)('%s pairs unstickAt with the width the bar disappears at', (file) => {
    const src = readFileSync(join(root, file), 'utf8');
    const opens = src.match(/<StickyActionBar[^>]*>/g) ?? [];
    expect(opens.length).toBeGreaterThan(0);
    for (const tag of opens) {
      const hiddenAtLg = tag.includes('lg:hidden');
      const unsticksAtLg = tag.includes('unstickAt="lg"');
      // A bar that survives past `sm:` has to stay sticky that far, and a bar that unsticks
      // at `lg:` has no reason to still be on screen above it.
      expect(hiddenAtLg).toBe(unsticksAtLg);
    }
  });
});
