// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OverdueGallons } from '@/components/dashboard/overdue-gallons';

vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, string | number>) => (v ? `${k}|${JSON.stringify(v)}` : k),
    locale: 'id',
  }),
}));

const SINCE = '2026-08-12T05:00:00.000Z';

describe('OverdueGallons', () => {
  // A badge is a claim. "Not known" and "none are late" both have nothing to claim, so both
  // render nothing — the only honest thing to say about an unknown is silence.
  it.each([
    ['null (the ledger did not say)', null],
    ['0 (nothing is late)', 0],
  ])('renders nothing for %s', (_label, overdue) => {
    for (const variant of ['badge', 'line'] as const) {
      const { container } = render(<OverdueGallons overdue={overdue} oldestAt={SINCE} variant={variant} />);
      expect(container.textContent).toBe('');
    }
  });

  it('shows how many gallons are late on the directory row, with the oldest date on hover', () => {
    const { container } = render(<OverdueGallons overdue={2} oldestAt={SINCE} variant="badge" />);
    expect(container.textContent).toContain('dashA.customers.overdueBadge');
    expect(container.textContent).toContain('"n":2');
    const holder = container.querySelector('[title]') as HTMLElement;
    expect(holder.title).toContain('dashA.customers.overdueSince');
    expect(holder.title).toContain('12');
  });

  it('gives the date in Jakarta time, not the device zone', () => {
    // 17:30 UTC on the 11th is already the 12th in Jakarta.
    render(<OverdueGallons overdue={1} oldestAt="2026-08-11T17:30:00.000Z" variant="line" />);
    expect(screen.getByRole('status').textContent).toContain('12');
  });

  it('says it in a sentence on the customer card, announced as a status', () => {
    render(<OverdueGallons overdue={3} oldestAt={SINCE} variant="line" />);
    const line = screen.getByRole('status');
    expect(line.textContent).toContain('dashA.customerDetail.overdueLine');
    expect(line.textContent).toContain('"n":3');
  });

  it('still shows the count when the oldest date is missing, just without the hover date', () => {
    const { container } = render(<OverdueGallons overdue={1} oldestAt={null} variant="badge" />);
    expect(container.textContent).toContain('dashA.customers.overdueBadge');
    expect(container.querySelector('[title]')).toBeNull();
  });
});
