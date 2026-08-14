// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'kd-1', role: 'KEPALA_DEPOT' } }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'depot-a',
    selected: { id: 'depot-a', name: 'Depot A' },
    depots: [{ id: 'depot-a', name: 'Depot A' }],
    ready: true,
  }),
}));

import { LocaleProvider } from '@/lib/locale-context';
import BroadcastPage from '@/app/dashboard/broadcast/page';

const renderPage = (): void => {
  render(
    <LocaleProvider>
      <BroadcastPage />
    </LocaleProvider>,
  );
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) =>
    path.includes('segment-estimate') || path.includes('audience-reach')
      ? Promise.resolve({ count: 42 })
      : Promise.resolve([]),
  );
  post.mockResolvedValue({ id: 'bc-1' });
});
afterEach(() => vi.clearAllMocks());

async function compose(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderPage();
  await user.type(await screen.findByLabelText(/Judul/i), 'Jalan ditutup');
  await user.type(screen.getByLabelText(/Pesan|Isi/i), 'Lewat Sudirman.');
  return user;
}

/*
 * One composer, two channels. "Kurir" posts a depot announcement to crm `POST /broadcasts`,
 * whose CreateBroadcastDto is {depotId,title,body,level?} behind a `forbidNonWhitelisted`
 * pipe — the page used to add `audience`, so EVERY send was a 400 and no depot broadcast
 * could be posted at all. The customer chips were the reason that field existed and were a
 * second lie on top: that endpoint only ever reaches couriers.
 */
describe('depot broadcast composer', () => {
  it('posts a courier announcement with only the fields the crm DTO accepts', async () => {
    const user = await compose();
    await user.click(screen.getByRole('button', { name: /Kirim/i }));

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] ?? [];
    expect(path).toContain('/broadcasts');
    expect(Object.keys(body as object).sort()).toEqual(['body', 'depotId', 'level', 'title']);
  });

  it('sends a customer segment as a depot campaign, not as a courier notice', async () => {
    const user = await compose();
    await user.click(screen.getByRole('button', { name: /churn|Berisiko/i }));
    await user.click(screen.getByRole('button', { name: /Kirim/i }));

    const [path, body] = post.mock.calls[0] ?? [];
    expect(path).toBe('/crm/api/v1/campaigns/depot');
    expect(body).toMatchObject({ depotId: 'depot-a', segment: { lapsedDays: 60 } });
  });

  /*
   * The chip's number and the blast's audience come from one constant. It used to show a
   * literal 18 for churn, so the screen promised a size nothing had measured.
   */
  it('sizes each customer chip with the conditions it will send with', async () => {
    const user = await compose();
    await user.click(screen.getByRole('button', { name: /churn|Berisiko/i }));

    await screen.findAllByText(/42/);
    const sized = get.mock.calls.map(([p]) => p as string).filter((p) => p.includes('segment-estimate'));
    expect(sized.some((p) => p.includes('lapsedDays=60') && p.includes('depotId=depot-a'))).toBe(true);
    expect(screen.queryByText('18')).toBeNull();
  });
});
