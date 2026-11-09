// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({ RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true }) }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [{ id: 'd1', name: 'Pekayon' }], scopedId: 'd1', selected: null, ready: true }),
}));

import BroadcastPage from '@/app/dashboard/broadcast/page';
import { ConfirmProvider } from '@/components/confirm';
import { endpoints } from '@/lib/endpoints';
import { LocaleProvider } from '@/lib/locale-context';

const draw = () =>
  render(
    <LocaleProvider>
      <ConfirmProvider>
        <BroadcastPage />
      </ConfirmProvider>
    </LocaleProvider>,
  );

describe('depot broadcast page · my customer campaigns (CRM-05)', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation(async (path: string) => {
      if (String(path) === endpoints.crm.myCampaigns) {
        return {
          items: [{ id: 'c1', name: 'Promo Pekan Ini', status: 'COMPLETED_WITH_FAILURES', totalRecipients: 40, sentCount: 31, failedCount: 9 }],
        };
      }
      return [];
    });
  });

  it('shows the result of a campaign the manager created', async () => {
    draw();
    expect(await screen.findByText('Promo Pekan Ini')).toBeTruthy();
    expect(screen.getByText(/40 penerima · 31 terkirim · 9 gagal/)).toBeTruthy();
  });

  it('says so when there are none', async () => {
    get.mockImplementation(async (path: string) => (String(path) === endpoints.crm.myCampaigns ? { items: [] } : []));
    draw();
    expect(await screen.findByText(/Belum ada kampanye pelanggan/)).toBeTruthy();
  });
});
