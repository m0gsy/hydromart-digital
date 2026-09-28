// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RunwayCell } from '@/components/dashboard/runway-cell';

vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, string | number>) => (v ? `${k}|${JSON.stringify(v)}` : k),
    locale: 'id',
  }),
}));

// A <td> needs a table around it to be valid DOM.
const cell = (available: number | undefined, avgDaily: number) => {
  const { container } = render(
    <table>
      <tbody>
        <tr>
          <RunwayCell available={available} avgDaily={avgDaily} />
        </tr>
      </tbody>
    </table>,
  );
  return container.querySelector('td') as HTMLElement;
};

describe('RunwayCell', () => {
  it('shows the days left, in the warning colour once it is three or fewer', () => {
    const soon = cell(20, 10);
    expect(soon.textContent).toContain('dashboard.forecast.daysToStockoutValue');
    expect(soon.textContent).toContain('"n":2');
    expect(soon.className).toContain('text-[color:var(--warning)]');

    const later = cell(100, 10);
    expect(later.textContent).toContain('"n":10');
    expect(later.className).not.toContain('text-[color:var(--warning)]');
  });

  it('warns at exactly three days, not only below it', () => {
    expect(cell(30, 10).className).toContain('text-[color:var(--warning)]');
    expect(cell(40, 10).className).not.toContain('text-[color:var(--warning)]');
  });

  // The bug this cell exists to keep dead: "no stock figure for this product" used to render
  // "Aman" (safe), the same as "nothing is selling". Unknown is not safe.
  it('does NOT call a product safe when the depot has no stock figure for it', () => {
    const td = cell(undefined, 10);
    expect(td.textContent).toBe('dashboard.forecast.daysToStockoutUnknown');
    expect(td.textContent).not.toContain('daysToStockoutNa');
    // …and says why, on hover.
    expect(td.title).toBe('dashboard.forecast.stockUnknownHint');
  });

  it('says safe only when stock is known and nothing is selling', () => {
    expect(cell(50, 0).textContent).toBe('dashboard.forecast.daysToStockoutNa');
  });

  it('reads an out-of-stock product as zero days, in the warning colour', () => {
    const td = cell(0, 10);
    expect(td.textContent).toContain('"n":0');
    expect(td.className).toContain('text-[color:var(--warning)]');
  });
});
