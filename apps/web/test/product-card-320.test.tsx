/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProductCard } from '@/components/product-card';

/**
 * A1 — the add-to-cart button that painted zero visible pixels on a 320px screen.
 *
 * This asserts the CLASS CONTRACT, not the geometry, and that is deliberate: jsdom has no
 * layout engine, so `offsetWidth`/`getBoundingClientRect()` are all zero and the geometric
 * assertion the plan proposed (`offsetLeft + offsetWidth <= 104`) would pass vacuously —
 * green forever, whatever the card did. A test that cannot fail is worse than no test.
 *
 * The geometry is proven in two other places instead:
 *   - PR-0's synthetic harness measured the broken shape in real Chromium: button at x=144
 *     against a clip edge at x=136, `btnVisiblePx: 0`.
 *   - `e2e-static/export.spec.ts` runs a 320×568 project over the real exported build.
 *     That guard is blind to THIS defect (a local clip narrower than the viewport), which
 *     is exactly why the three classes below need pinning by name.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: null }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));

const PRODUCT = {
  id: 'prod_1',
  name: 'Galon Air Mineral 19L',
  unit: '19 Liter',
  basePrice: 22_000,
  imageUrl: null,
} as never;

function priceRowOf(container: HTMLElement): HTMLElement {
  // The row holding the price column and the add button — the flex line that overflowed.
  const button = screen.getByRole('button');
  const row = button.parentElement as HTMLElement;
  expect(row, 'the add button must still sit in a row with the price').toBeTruthy();
  expect(container.contains(row)).toBe(true);
  return row;
}

describe('A1: the product card must be able to give way at 320px', () => {
  it('lets the row wrap instead of pushing the button out of the card', () => {
    const { container } = render(<ProductCard product={PRODUCT} memberRate={10} />);
    expect(priceRowOf(container).className).toContain('flex-wrap');
  });

  it('lets the price column shrink below its content width', () => {
    // Without `min-w-0` a flex child's `min-width: auto` refuses to shrink past its content,
    // which is the mechanism that pushed the button past the card's clip edge.
    const { container } = render(<ProductCard product={PRODUCT} memberRate={10} />);
    const column = priceRowOf(container).firstElementChild as HTMLElement;
    expect(column.className).toContain('min-w-0');
  });

  it('does not forbid the member chip from wrapping', () => {
    const { container } = render(<ProductCard product={PRODUCT} memberRate={10} />);
    expect(
      container.innerHTML.includes('whitespace-nowrap'),
      'whitespace-nowrap on the member chip is the original defect',
    ).toBe(false);
  });
});
