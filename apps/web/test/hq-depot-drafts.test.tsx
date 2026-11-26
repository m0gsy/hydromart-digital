// @vitest-environment jsdom
//
// HD-21b - HQ decides on the depot drafts the CRM calon mitra made: the list, and the detail with
// its two actions. Tolak needs a note; "Undang pemilik dan aktifkan" invites a FRANCHISE_OWNER with
// the existing staff invite and only then opens the depot form, which posts to the activate route.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, push, toast, askReason, auth, formProps } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
  askReason: vi.fn(),
  auth: { role: 'HEAD_OFFICE' as string },
  formProps: { current: null as null | { submitTo?: string; initial?: Record<string, unknown> } },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}|${JSON.stringify(vars)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: auth.role } }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ askReason }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/depot-drafts',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'draft-1' }));
// The depot form is its own screen with its own tests: here only what the page hands it matters.
vi.mock('@/components/hq/depot-form', () => ({
  DepotForm: (props: { submitTo?: string; initial?: Record<string, unknown> }) => {
    formProps.current = props;
    return <div data-testid="depot-form">{props.submitTo}</div>;
  },
}));

import HqDepotDraftDetailPage from '@/app/hq/depot-drafts/detail/page';
import HqDepotDraftsPage from '@/app/hq/depot-drafts/page';
import { earliestSigning } from '@/lib/depot-drafts';

const draft = (over: Record<string, unknown> = {}) => ({
  id: 'draft-1',
  prospectId: '00000000-0000-4000-8000-0000000000a1',
  legacyApplicationId: null,
  proposedName: 'Depot Contoh',
  city: 'Bekasi',
  province: 'Jawa Barat',
  ownerFullName: 'Budi Santoso',
  ownerPhoneE164: '+6281234567890',
  prospectusHandedOn: '2026-10-01',
  agreementSignedOn: '2026-10-20',
  prospectusSha256: 'a'.repeat(64),
  prospectusVersionLabel: 'v1',
  prospectusReceipt: 'Tanda terima 1',
  checklist: { ktpNpwp: 'VERIFIED', locationProof: 'VERIFIED', capitalDeposit: 'SUBMITTED', fieldSurvey: 'VERIFIED' },
  status: 'DRAFT',
  decisionNote: null,
  decidedAt: null,
  depotId: null,
  createdAt: '2026-11-20T03:00:00.000Z',
  updatedAt: '2026-11-20T03:00:00.000Z',
  ...over,
});

beforeEach(() => {
  sessionStorage.clear();
  auth.role = 'HEAD_OFFICE';
  formProps.current = null;
});
afterEach(() => vi.clearAllMocks());

describe('earliestSigning', () => {
  it('is 14 calendar days after the prospectus, across a month and a leap day', () => {
    expect(earliestSigning('2026-10-01')).toBe('2026-10-15');
    expect(earliestSigning('2026-10-25')).toBe('2026-11-08');
    expect(earliestSigning('2028-02-20')).toBe('2028-03-05');
  });
});

describe('/hq/depot-drafts', () => {
  it('lists the drafts with their status and opens one', async () => {
    const item = (over: Record<string, unknown>) => ({
      id: 'draft-1',
      proposedName: 'Depot Contoh',
      city: 'Bekasi',
      province: 'Jawa Barat',
      status: 'DRAFT',
      checklist: { verified: 3, total: 4 },
      createdAt: '2026-11-20T03:00:00.000Z',
      decidedAt: null,
      ageDays: 9,
      ...over,
    });
    get.mockResolvedValue({ items: [item({}), item({ id: 'draft-2', proposedName: 'Depot Lain', status: 'REJECTED', ageDays: 2 })], total: 2, page: 1, limit: 50 });
    render(<HqDepotDraftsPage />);
    expect(await screen.findByText('Depot Contoh')).toBeTruthy();
    // The age of each draft is on the row, so a stale one is seen.
    expect(screen.getByText('hq.depotDrafts.age|{"n":9}')).toBeTruthy();
    expect(screen.getByText('hq.depotDrafts.age|{"n":2}')).toBeTruthy();
    expect(screen.getByText('Depot Lain')).toBeTruthy();
    expect(screen.getByText('hq.depotDrafts.status.REJECTED')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/depots/api/v1/depot-drafts?page=1&limit=50', true);
    await userEvent.click(screen.getAllByText('hq.depotDrafts.review')[0]!);
    expect(push).toHaveBeenCalledWith('/hq/depot-drafts/detail?id=draft-1');
  });

  it('says so when there is nothing, and when the list cannot be loaded', async () => {
    get.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 50 });
    const first = render(<HqDepotDraftsPage />);
    expect(await screen.findByText('hq.depotDrafts.empty')).toBeTruthy();
    first.unmount();
    get.mockRejectedValueOnce(new Error('down'));
    render(<HqDepotDraftsPage />);
    expect(await screen.findByText('hq.depotDrafts.loadError')).toBeTruthy();
  });
});

describe('/hq/depot-drafts/detail', () => {
  it('shows the draft, the checklist and the 14-day check', async () => {
    get.mockResolvedValue(draft());
    render(<HqDepotDraftDetailPage />);
    expect(await screen.findByText(/Budi Santoso/)).toBeTruthy();
    expect(screen.getByText(/\+6281234567890/)).toBeTruthy();
    expect(screen.getByText('hq.depotDrafts.detail.state.SUBMITTED')).toBeTruthy();
    expect(screen.getByText(/a{64}/)).toBeTruthy();
    expect(screen.getByText(/hq\.depotDrafts\.detail\.coolingOk/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/depots/api/v1/depot-drafts/draft-1', true);
  });

  it('flags an agreement signed too early', async () => {
    get.mockResolvedValue(draft({ agreementSignedOn: '2026-10-10' }));
    render(<HqDepotDraftDetailPage />);
    expect(await screen.findByText(/hq\.depotDrafts\.detail\.coolingNot/)).toBeTruthy();
    expect(screen.getByText(/2026-10-15/)).toBeTruthy();
  });

  it('rejects with a note, posts it, and goes back to the list; a cancelled prompt posts nothing', async () => {
    get.mockResolvedValue(draft());
    post.mockResolvedValue({});
    render(<HqDepotDraftDetailPage />);
    const reject = await screen.findByText('hq.depotDrafts.detail.reject');
    askReason.mockResolvedValueOnce(null);
    await userEvent.click(reject);
    expect(post).not.toHaveBeenCalled();
    askReason.mockResolvedValueOnce('kurang dokumen');
    await userEvent.click(reject);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/depots/api/v1/depot-drafts/draft-1/reject', { note: 'kurang dokumen' }, true));
    expect(askReason).toHaveBeenCalledWith(expect.objectContaining({ optional: false }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/hq/depot-drafts'));
  });

  it('invites a FRANCHISE_OWNER first, then opens the depot form prefilled and aimed at the activate route', async () => {
    get.mockResolvedValue(draft());
    post.mockResolvedValue({ id: 'owner-9' });
    render(<HqDepotDraftDetailPage />);
    await userEvent.click(await screen.findByText('hq.depotDrafts.detail.activate'));
    await waitFor(() => expect(screen.getByTestId('depot-form')).toBeTruthy());
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/auth/api/v1/auth/staff/invite',
      expect.objectContaining({ phone: '+6281234567890', role: 'FRANCHISE_OWNER', fullName: 'Budi Santoso' }),
      true,
    );
    expect(formProps.current?.submitTo).toBe('/depots/api/v1/depot-drafts/draft-1/activate');
    expect(formProps.current?.initial).toMatchObject({
      name: 'Depot Contoh',
      city: 'Bekasi',
      province: 'Jawa Barat',
      ownershipType: 'WARALABA',
      owners: [{ ownerId: 'owner-9', sharePct: '100', isPrimary: true }],
    });
    // The invite is not offered a second time.
    expect((screen.getByText('hq.depotDrafts.detail.activate').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the invited owner for this draft across a reload: no second invite, the form opens straight away', async () => {
    get.mockResolvedValue(draft());
    post.mockResolvedValue({ id: 'owner-9' });
    const first = render(<HqDepotDraftDetailPage />);
    await userEvent.click(await screen.findByText('hq.depotDrafts.detail.activate'));
    await waitFor(() => expect(screen.getByTestId('depot-form')).toBeTruthy());
    expect(sessionStorage.getItem('hq.depotDraft.owner.draft-1')).toBe('owner-9');
    first.unmount();
    render(<HqDepotDraftDetailPage />);
    await waitFor(() => expect(screen.getByTestId('depot-form')).toBeTruthy());
    expect(formProps.current?.initial).toMatchObject({ owners: [{ ownerId: 'owner-9' }] });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejecting after an invite says the owner account stays; the kept id is forgotten once rejected', async () => {
    get.mockResolvedValue(draft());
    post.mockResolvedValue({ id: 'owner-9' });
    render(<HqDepotDraftDetailPage />);
    await userEvent.click(await screen.findByText('hq.depotDrafts.detail.activate'));
    await waitFor(() => expect(screen.getByTestId('depot-form')).toBeTruthy());
    askReason.mockResolvedValueOnce('batal');
    await userEvent.click(screen.getByText('hq.depotDrafts.detail.reject'));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/depots/api/v1/depot-drafts/draft-1/reject', { note: 'batal' }, true));
    expect(askReason.mock.calls[0]![0].message).toContain('hq.depotDrafts.detail.rejectAfterInvite');
    expect(sessionStorage.getItem('hq.depotDraft.owner.draft-1')).toBeNull();
  });

  it('without an invite the reject prompt does not mention an owner account', async () => {
    get.mockResolvedValue(draft());
    post.mockResolvedValue({});
    render(<HqDepotDraftDetailPage />);
    askReason.mockResolvedValueOnce('batal');
    await userEvent.click(await screen.findByText('hq.depotDrafts.detail.reject'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(askReason.mock.calls[0]![0].message).not.toContain('rejectAfterInvite');
  });

  it('opens no form when the invite fails, and says why', async () => {
    get.mockResolvedValue(draft());
    post.mockRejectedValue(new Error('x'));
    render(<HqDepotDraftDetailPage />);
    await userEvent.click(await screen.findByText('hq.depotDrafts.detail.activate'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('hq.depotDrafts.detail.inviteError', 'error'));
    expect(screen.queryByTestId('depot-form')).toBeNull();
  });

  it('a role without staff-admin cannot invite: the button is off and the hint says who can', async () => {
    auth.role = 'DIREKTUR';
    get.mockResolvedValue(draft());
    render(<HqDepotDraftDetailPage />);
    const button = (await screen.findByText('hq.depotDrafts.detail.activate')).closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('hq.depotDrafts.detail.needStaffAdmin')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('a decided draft shows its note, no actions, no owner data, and a link to the depot', async () => {
    get.mockResolvedValue(
      draft({ status: 'ACTIVATED', ownerFullName: null, ownerPhoneE164: null, decisionNote: 'ok', depotId: 'depot-7' }),
    );
    render(<HqDepotDraftDetailPage />);
    expect(await screen.findByText('hq.depotDrafts.detail.ownerCleared')).toBeTruthy();
    expect(screen.queryByText('hq.depotDrafts.detail.reject')).toBeNull();
    expect(screen.queryByText('hq.depotDrafts.detail.activate')).toBeNull();
    expect(screen.getByText('hq.depotDrafts.detail.openDepot').closest('a')?.getAttribute('href')).toBe('/hq/depots/detail?id=depot-7');
    expect(screen.queryByText(/Budi Santoso/)).toBeNull();
  });

  it('shows not-found when the draft cannot be read', async () => {
    get.mockRejectedValue(new Error('404'));
    render(<HqDepotDraftDetailPage />);
    expect(await screen.findByText('hq.depotDrafts.detail.notFound')).toBeTruthy();
  });
});
