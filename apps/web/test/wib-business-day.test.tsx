// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ rows: [], total: 0 }), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: 'MANAGER' } }) }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [{ id: 'd1', name: 'Pekayon' }], scopedId: 'd1', selected: null }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/hr/depot-picker', () => ({ HrDepotPicker: () => null }));

import DepotRequestsPage from '@/app/hr/depot-requests/page';
import { LocaleProvider } from '@/lib/locale-context';

/*
 * WEB-13. The business day is WIB. A phone set to WITA at 23:30 WIB already believes it is
 * tomorrow, so a date input built from the device calendar offered tomorrow as "today".
 */
describe('the business day does not follow the device zone (WEB-13)', () => {
  const realTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'Asia/Makassar'; // UTC+8, one hour ahead of WIB
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T16:30:00Z')); // 23:30 WIB on the 9th, 00:30 WITA on the 10th
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = realTz;
  });

  it('offers the WIB date as the earliest start', () => {
    const { container } = render(
      <LocaleProvider>
        <DepotRequestsPage />
      </LocaleProvider>,
    );
    const input = container.querySelector('input[type="date"][min]') as HTMLInputElement | null;
    expect(input?.min).toBe('2026-11-09');
  });
});
