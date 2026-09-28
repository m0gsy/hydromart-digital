// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CashierSales } from '@/components/dashboard/cashier-sales';
import { HourChart, busiestHour } from '@/components/dashboard/hour-chart';
import type { DepotDailyCashier, DepotHourBucket } from '@/lib/types';

// Echo the key and the interpolation values, so a test can assert both WHICH sentence was
// chosen and WHAT numbers went into it without depending on the Indonesian copy.
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, string | number>) => (v ? `${k}|${JSON.stringify(v)}` : k),
    locale: 'id',
  }),
}));

const day = (over: Record<number, { orders: number; revenueIdr: number }> = {}): DepotHourBucket[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orders: over[hour]?.orders ?? 0,
    revenueIdr: over[hour]?.revenueIdr ?? 0,
  }));

describe('busiestHour', () => {
  it('is null when nothing sold, so the chart can say so instead of drawing 24 flat bars', () => {
    expect(busiestHour(day())).toBeNull();
    expect(busiestHour([])).toBeNull();
  });

  it('picks the hour with the most ORDERS, not the most revenue', () => {
    const hours = day({ 8: { orders: 5, revenueIdr: 100_000 }, 15: { orders: 2, revenueIdr: 900_000 } });
    expect(busiestHour(hours)?.hour).toBe(8);
  });

  it('gives a tie to the earlier hour, so the sentence does not change between renders', () => {
    const hours = day({ 17: { orders: 4, revenueIdr: 1 }, 8: { orders: 4, revenueIdr: 1 } });
    expect(busiestHour(hours)?.hour).toBe(8);
  });
});

describe('HourChart', () => {
  it('draws all 24 hours, highlights the busiest, and states the answer in words', () => {
    const { container } = render(
      <HourChart hours={day({ 8: { orders: 4, revenueIdr: 80_000 }, 17: { orders: 1, revenueIdr: 20_000 } })} />,
    );
    const chart = screen.getByRole('img');
    expect(chart.querySelectorAll('[title]')).toHaveLength(24);
    const peak = chart.querySelector('[title^="08.00"]') as HTMLElement;
    expect(peak.className).toContain('bg-brand-600');
    expect(peak.style.height).toBe('100%');
    // The quieter hour keeps a real, proportional bar rather than the highlight.
    const quiet = chart.querySelector('[title^="17.00"]') as HTMLElement;
    expect(quiet.className).toContain('bg-brand-50');
    expect(quiet.style.height).toBe('25%');
    // The sentence carries the answer for a reader who cannot see colour.
    expect(container.textContent).toContain('opsFix.reports.hoursPeak');
    expect(container.textContent).toContain('"from":"08.00","to":"09.00","orders":4');
  });

  it('keeps an empty hour visible as a 2% sliver, so the axis never loses a slot', () => {
    render(<HourChart hours={day({ 8: { orders: 3, revenueIdr: 1 } })} />);
    const empty = screen.getByRole('img').querySelector('[title^="12.00"]') as HTMLElement;
    expect(empty.style.height).toBe('2%');
    expect(empty.className).toContain('bg-brand-50');
  });

  it('gives a very small hour a floor so it is still a bar, not a hairline', () => {
    render(<HourChart hours={day({ 8: { orders: 200, revenueIdr: 1 }, 9: { orders: 1, revenueIdr: 1 } })} />);
    const small = screen.getByRole('img').querySelector('[title^="09.00"]') as HTMLElement;
    expect(small.style.height).toBe('6%');
  });

  it('highlights every hour tied for busiest', () => {
    render(<HourChart hours={day({ 8: { orders: 4, revenueIdr: 1 }, 17: { orders: 4, revenueIdr: 1 } })} />);
    const chart = screen.getByRole('img');
    for (const hour of ['08.00', '17.00']) {
      expect((chart.querySelector(`[title^="${hour}"]`) as HTMLElement).className).toContain('bg-brand-600');
    }
  });

  it('wraps 23.00 to 00.00 instead of printing hour 24', () => {
    const { container } = render(<HourChart hours={day({ 23: { orders: 2, revenueIdr: 1 } })} />);
    expect(container.textContent).toContain('"from":"23.00","to":"00.00"');
  });

  it('labels the axis every three hours and puts the exact revenue in each tooltip', () => {
    const { container } = render(<HourChart hours={day({ 8: { orders: 2, revenueIdr: 50_000 } })} />);
    const axis = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    const labels = Array.from(axis.children).map((c) => c.textContent);
    expect(labels).toHaveLength(24);
    expect(labels.filter(Boolean)).toEqual(['00', '03', '06', '09', '12', '15', '18', '21']);
    expect((screen.getByRole('img').querySelector('[title^="08.00"]') as HTMLElement).title).toMatch(/50\.000/);
  });

  it('gives the chart a text alternative that repeats the answer', () => {
    render(<HourChart hours={day({ 8: { orders: 2, revenueIdr: 1 } })} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('opsFix.reports.hoursAria');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('08.00');
  });

  it('says there are no orders instead of drawing an empty chart', () => {
    render(<HourChart hours={day()} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('opsFix.reports.hoursEmpty')).toBeTruthy();
  });
});

describe('CashierSales', () => {
  const rows: DepotDailyCashier[] = [
    { cashierId: 'c-budi', label: '0811', orders: 2, revenueIdr: 50_000 },
    { cashierId: 'c-sari', label: null, orders: 1, revenueIdr: 20_000 },
  ];

  it('lists each cashier with their orders and revenue, and falls back to the id when there is no label', () => {
    const { container } = render(<CashierSales rows={rows} />);
    const cells = Array.from(container.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.children).map((td) => td.textContent),
    );
    expect(cells[0]?.[0]).toBe('0811');
    expect(cells[0]?.[1]).toBe('2');
    expect(cells[0]?.[2]).toMatch(/50\.000/);
    expect(cells[1]?.[0]).toBe('c-sari');
    expect(cells[1]?.[1]).toBe('1');
  });

  it('shows sales rung before the cashier was recorded as their own line, and explains it once', () => {
    render(
      <CashierSales
        rows={[...rows, { cashierId: null, label: null, orders: 3, revenueIdr: 9_000 }]}
      />,
    );
    expect(screen.getByText('opsFix.reports.cashiersNotRecorded')).toBeTruthy();
    expect(screen.getAllByText('opsFix.reports.cashiersNotRecordedHint')).toHaveLength(1);
  });

  it('does not print the "not recorded" explanation when every sale has a cashier', () => {
    render(<CashierSales rows={rows} />);
    expect(screen.queryByText('opsFix.reports.cashiersNotRecordedHint')).toBeNull();
  });

  it('says nobody sold at the till instead of drawing an empty table', () => {
    const { container } = render(<CashierSales rows={[]} />);
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('opsFix.reports.cashiersEmpty')).toBeTruthy();
  });
});
