// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Flow plan 5b: head office groups churn by the risk band forecast-service computes — the same
 * one the depot's churn list shows — not by its own day thresholds. A customer the server rates
 * HIGH is under "Risiko tinggi" here too, however recently they ordered.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get, getCached: get, post: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { LocaleProvider } from '@/lib/locale-context';
import HqChurnPage from '@/app/hq/churn/page';

const row = (name: string, daysSince: number, riskBand: 'LOW' | 'MEDIUM' | 'HIGH') => ({
  customerId: `c-${name}`,
  customerName: name,
  lastOrderAt: '2026-11-01T00:00:00.000Z',
  orderCount: 3,
  daysSince,
  riskScore: 0.5,
  riskBand,
});

describe('HQ churn (flow 5b)', () => {
  it("groups by the server's risk band, not by days since the last order", async () => {
    get.mockResolvedValue({
      // Ordered 3 days ago, yet the model rates them HIGH: the band decides, not the days.
      customers: [row('Ayu', 3, 'HIGH'), row('Bayu', 80, 'LOW')],
    });
    render(
      <LocaleProvider>
        <HqChurnPage />
      </LocaleProvider>,
    );

    const high = (await screen.findByText('Risiko tinggi')).closest('div')!.parentElement!;
    expect(within(high).getByText('Ayu')).toBeTruthy();
    const low = screen.getByText('Risiko rendah').closest('div')!.parentElement!;
    expect(within(low).getByText('Bayu')).toBeTruthy();
    expect(screen.queryByText('Aktif')).toBeNull();
  });
});
