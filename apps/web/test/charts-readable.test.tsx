// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BarTrend, CohortGrid } from '@/components/hq/charts';

vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));

/**
 * A number that lives only in `title=` is a number nobody on a phone can read.
 *
 * Both charts on `/hq/analytics` put their value in a hover tooltip and nowhere else. The
 * retention cell was the starkest: a bare coloured square, no text at all — which is exactly
 * how it renders in a screenshot, and exactly how it reads to a screen reader. Hover does not
 * exist on the surface these are mostly opened on.
 *
 * These tests assert the value is in the DOM as text. `title` is kept as well, so a pointer
 * still gets the exact figure; the rendered label is allowed to be compact.
 */
describe('the charts say their numbers out loud', () => {
  it('renders the cohort percentage in the cell, not only on hover', () => {
    const { container } = render(<CohortGrid rows={[{ label: '2026-08', cells: [0.42, 0.9] }]} />);
    const text = container.textContent ?? '';
    expect(text).toContain('42');
    expect(text).toContain('90');
    // …and the tooltip is still there for a pointer.
    expect(container.querySelector('[title="42%"]')).not.toBeNull();
  });

  it('renders each bar value above the bar', () => {
    const { container } = render(
      <BarTrend
        data={[
          { label: '2026-07', value: 0 },
          { label: '2026-08', value: 263000 },
        ]}
      />,
    );
    const text = container.textContent ?? '';
    // Compact, because a bar label is one line: 263000 → "263rb".
    expect(text).toContain('263rb');
    // A zero month still says zero rather than showing an empty column and no explanation.
    expect(text).toContain('0');
    expect(container.querySelector('[title="263000"]')).not.toBeNull();
  });

  /*
   * The zero bar keeps its 2px floor — a month with no revenue must still occupy its slot,
   * or the axis silently loses a month. What changed is that the reader is now told it is
   * zero instead of being left to read an empty card.
   */
  it('keeps a zero month visible as a slot', () => {
    const { container } = render(<BarTrend data={[{ label: '2026-07', value: 0 }]} />);
    const bar = container.querySelector('[title="0"]') as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar!.style.height).toBe('2%');
  });
});
