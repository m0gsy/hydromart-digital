// @vitest-environment jsdom
//
// HD-12/HD-13, the depot CRM follow-up list: the wa.me chat button shows only for a customer the server says
// is OPTED_IN. STOPPED and NONE get a muted line, and a failed call (or an off channel) fails closed.
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get, post }, ApiError: class extends Error {} }));
vi.mock('@/components/require-auth', () => ({ RequireAuth: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'me', role: 'KEPALA_DEPOT' } }) }));
vi.mock('@/lib/roles', () => ({ canViewDepotCrm: () => true }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'd1', selected: { name: 'Depot', code: 'D1' }, depots: [] }),
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));

import CrmPage from '@/app/dashboard/crm/page';

const follow = (customerId: string, phone: string | null = '0811111') => ({
  customerId,
  name: customerId,
  phone,
  lastOrderAt: null,
  daysSinceLastOrder: 40,
  orderCount: 2,
  totalSpentIdr: 1000,
});
const dashboard = {
  counts: { baru: 1, aktif: 1, inactive: 1, total: 3 },
  repeatRatePct: 10,
  followUps: [follow('a'), follow('b'), follow('c'), follow('d', null)],
};

function serve(status: unknown) {
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/whatsapp/status')) {
      if (status instanceof Error) throw status;
      return status;
    }
    return dashboard;
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('depot CRM wa.me button state', () => {
  it('shows the chat button only for OPTED_IN, a muted line for STOPPED and NONE', async () => {
    serve({ enabled: true });
    post.mockResolvedValue({ a: 'OPTED_IN', b: 'STOPPED' });
    render(<CrmPage />);
    await waitFor(() => expect(screen.getByText('wa.crm.stopped')).toBeTruthy());
    expect(post).toHaveBeenCalledWith('/crm/api/v1/whatsapp/contact-state', { customerIds: ['a', 'b', 'c', 'd'] }, true);
    // a: button. b: stopped. c: absent from the answer = never opted in. d: no phone at all.
    expect(screen.getAllByText('dashA.crm.wa')).toHaveLength(1);
    expect(screen.getAllByText('wa.crm.never')).toHaveLength(1);
    expect(screen.getAllByText('dashA.crm.noPhone').length).toBeGreaterThan(0);
  });

  it('fails closed: no chat button and no label when contact-state fails', async () => {
    serve({ enabled: true });
    post.mockRejectedValue(new Error('503'));
    render(<CrmPage />);
    await screen.findByText('dashA.crm.followTitle');
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(screen.queryByText('dashA.crm.wa')).toBeNull();
    expect(screen.queryByText('wa.crm.never')).toBeNull();
    expect(screen.queryByText('wa.crm.stopped')).toBeNull();
  });

  it('fails closed when the status call fails', async () => {
    serve(new Error('404'));
    render(<CrmPage />);
    await screen.findByText('dashA.crm.followTitle');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/crm/api/v1/whatsapp/status', true));
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByText('dashA.crm.wa')).toBeNull();
  });

  it('while WhatsApp is off: no chat button, no label, and contact-state is not asked', async () => {
    serve({ enabled: false });
    render(<CrmPage />);
    await screen.findByText('dashA.crm.followTitle');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/crm/api/v1/whatsapp/status', true));
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByText('dashA.crm.wa')).toBeNull();
    expect(screen.queryByText('wa.crm.never')).toBeNull();
  });

  it('asks for at most 200 customers', async () => {
    const many = Array.from({ length: 230 }, (_, i) => follow(`c${i}`));
    get.mockImplementation(async (path: string) =>
      path.endsWith('/whatsapp/status') ? { enabled: true } : { ...dashboard, followUps: many },
    );
    post.mockResolvedValue({});
    render(<CrmPage />);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0]![1] as { customerIds: string[] }).customerIds).toHaveLength(200);
  });
});
