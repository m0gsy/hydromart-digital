// @vitest-environment jsdom
//
// HD-23: /hq/partner-bills (list, make drafts) and its detail (approve = send, void).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, role, search, confirmMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  role: { value: 'FINANCE' },
  search: { value: '?id=b1' },
}));

class FakeApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: confirmMock }) }));
vi.mock('@/lib/api', () => ({ api: { get, post }, ApiError: FakeApiError }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: role.value }, ready: true }),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'b1' }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const draft = {
  id: 'b1',
  legalEntityId: 'e1',
  legalEntityName: 'PT Mitra Air',
  month: '2026-10',
  status: 'DRAFT',
  totalIdr: 150_000,
  createdAt: '2026-11-08T00:00:00Z',
  approvedAt: null,
  sentAt: null,
  voidReason: null,
  bank: null,
  recipients: 0,
  lines: [
    {
      id: 'l1',
      depotId: 'd1',
      label: 'Royalti Depot Satu',
      amountIdr: 150_000,
      basis: { from: '2026-10-01', to: '2026-10-31', rows: 12, reversalRows: 2, reversalIdr: 5000 },
    },
  ],
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  role.value = 'FINANCE';
  vi.useRealTimers();
});

describe('/hq/partner-bills', () => {
  it('lists the month’s bills with their status and makes drafts, saying plainly when nothing was commissioned', async () => {
    get.mockResolvedValue([draft]);
    post.mockResolvedValueOnce({ month: '2026-10', made: 0, existing: 0, skippedZero: 0, unassigned: 0, commissionRows: 0 });
    const { default: Page } = await import('@/app/hq/partner-bills/page');
    render(<Page />);
    expect(await screen.findByText('PT Mitra Air')).toBeTruthy();
    expect(screen.getByText('hq.partnerBills.status.DRAFT')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'hq.partnerBills.hintLink' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'hq.partnerBills.generate' }));
    expect(await screen.findByText(/hq\.partnerBills\.resultNone/)).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/payout/api/v1/partner-bills/generate', { month: expect.stringMatching(/^\d{4}-\d{2}$/) }, true);
  });

  it('reports a run that made drafts, and names a refusal', async () => {
    get.mockResolvedValue([]);
    post
      .mockResolvedValueOnce({ month: '2026-10', made: 2, existing: 1, skippedZero: 0, unassigned: 0, commissionRows: 40 })
      .mockRejectedValueOnce(new FakeApiError(409, 'x', 'PARTNER_BILL_MONTH_NOT_CLOSED'))
      .mockRejectedValueOnce(new FakeApiError(503, 'x', 'PARTNER_BILL_SOURCE_UNAVAILABLE'))
      .mockRejectedValueOnce(new Error('boom'));
    const { default: Page } = await import('@/app/hq/partner-bills/page');
    render(<Page />);
    expect(await screen.findByText('hq.partnerBills.empty')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'hq.partnerBills.generate' });
    fireEvent.click(button);
    expect(await screen.findByText(/hq\.partnerBills\.result /)).toBeTruthy();
    fireEvent.click(button);
    expect(await screen.findByText('hq.partnerBills.monthOpen')).toBeTruthy();
    fireEvent.click(button);
    expect(await screen.findByText('hq.partnerBills.detail.sourceDown')).toBeTruthy();
    fireEvent.click(button);
    expect(await screen.findByText('hq.partnerBills.detail.failed')).toBeTruthy();
  });

  it('warns about depots without an owner and entities that could not be read', async () => {
    get.mockResolvedValue([]);
    post.mockResolvedValueOnce({ month: '2026-10', made: 1, existing: 0, skippedZero: 0, unassigned: 0, commissionRows: 9, unreadable: 1, noOwner: 2, noOwnerDepots: ['D-1', 'D-2'] });
    const { default: Page } = await import('@/app/hq/partner-bills/page');
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: 'hq.partnerBills.generate' }));
    expect(await screen.findByText(/hq\.partnerBills\.resultNoOwner.*D-1, D-2/)).toBeTruthy();
    expect(screen.getByText(/hq\.partnerBills\.resultUnreadable/)).toBeTruthy();
  });

  it('shows no make-drafts button to a role that may only read', async () => {
    role.value = 'DIREKTUR';
    get.mockResolvedValue([]);
    const { default: Page } = await import('@/app/hq/partner-bills/page');
    render(<Page />);
    await screen.findByText('hq.partnerBills.empty');
    expect(screen.queryByRole('button', { name: 'hq.partnerBills.generate' })).toBeNull();
  });

  it('shows a load error with a retry', async () => {
    get.mockRejectedValue(new Error('down'));
    const { default: Page } = await import('@/app/hq/partner-bills/page');
    render(<Page />);
    expect(await screen.findByText('hq.partnerBills.loadError')).toBeTruthy();
  });
});

describe('/hq/partner-bills/detail', () => {
  it('shows the lines and what each is made of, and sends the bill on one confirmed click', async () => {
    get.mockResolvedValue(draft);
    post.mockResolvedValue({});
    confirmMock.mockResolvedValue(true);
    const { default: Page } = await import('@/app/hq/partner-bills/detail/page');
    render(<Page />);
    expect(await screen.findByText('Royalti Depot Satu')).toBeTruthy();
    expect(screen.getByText(/hq\.partnerBills\.detail\.basisReversal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'hq.partnerBills.detail.approve' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/payout/api/v1/partner-bills/b1/approve', {}, true));
  });

  it('does not send when the confirmation is declined', async () => {
    get.mockResolvedValue(draft);
    confirmMock.mockResolvedValue(false);
    const { default: Page } = await import('@/app/hq/partner-bills/detail/page');
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: 'hq.partnerBills.detail.approve' }));
    expect(post).not.toHaveBeenCalled();
  });

  it('says why a bill cannot be sent without the official account, and links to where to enter it', async () => {
    get.mockResolvedValue(draft);
    post.mockRejectedValueOnce(new FakeApiError(409, 'x', 'BANK_ACCOUNT_MISSING'));
    confirmMock.mockResolvedValue(true);
    const { default: Page } = await import('@/app/hq/partner-bills/detail/page');
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: 'hq.partnerBills.detail.approve' }));
    expect(await screen.findByText(/hq\.partnerBills\.detail\.bankMissing$/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'hq.partnerBills.detail.bankMissingLink' })).toBeTruthy();
  });

  it('names the other refusals', async () => {
    get.mockResolvedValue(draft);
    post
      .mockRejectedValueOnce(new FakeApiError(409, 'x', 'PARTNER_BILL_NO_RECIPIENTS'))
      .mockRejectedValueOnce(new FakeApiError(503, 'x', 'PARTNER_BILL_SOURCE_UNAVAILABLE'))
      .mockRejectedValueOnce(new Error('boom'));
    confirmMock.mockResolvedValue(true);
    const { default: Page } = await import('@/app/hq/partner-bills/detail/page');
    render(<Page />);
    const approve = await screen.findByRole('button', { name: 'hq.partnerBills.detail.approve' });
    fireEvent.click(approve);
    expect(await screen.findByText('hq.partnerBills.detail.noRecipients')).toBeTruthy();
    fireEvent.click(approve);
    expect(await screen.findByText('hq.partnerBills.detail.sourceDown')).toBeTruthy();
    fireEvent.click(approve);
    expect(await screen.findByText('hq.partnerBills.detail.failed')).toBeTruthy();
  });

  it('voids with a reason of at least three characters', async () => {
    get.mockResolvedValue({ ...draft, status: 'SENT', sentAt: '2026-11-09T00:00:00Z', recipients: 2, bank: { bankName: 'BCA', bankAccountNumber: '1', bankAccountHolder: 'PT' } });
    post.mockResolvedValue({});
    const { default: Page } = await import('@/app/hq/partner-bills/detail/page');
    render(<Page />);
    expect(screen.queryByRole('button', { name: 'hq.partnerBills.detail.approve' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'hq.partnerBills.detail.void' }));
    const confirm = screen.getByRole('button', { name: 'hq.partnerBills.detail.voidConfirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('hq.partnerBills.detail.voidReason'), { target: { value: ' salah badan hukum ' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/payout/api/v1/partner-bills/b1/void', { reason: 'salah badan hukum' }, true),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'hq.partnerBills.detail.void' }));
    fireEvent.click(screen.getByRole('button', { name: 'hq.partnerBills.detail.voidCancel' }));
    expect(screen.queryByLabelText('hq.partnerBills.detail.voidReason')).toBeNull();
  });

  it('shows a voided bill with its reason, no buttons, and hides decisions from a reader', async () => {
    get.mockResolvedValue({ ...draft, status: 'VOID', voidReason: 'salah' });
    const { default: Page } = await import('@/app/hq/partner-bills/detail/page');
    const view = render(<Page />);
    expect(await screen.findByText(/hq\.partnerBills\.detail\.voidedFor/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'hq.partnerBills.detail.void' })).toBeNull();
    view.unmount();
    role.value = 'DIREKTUR';
    get.mockResolvedValue(draft);
    render(<Page />);
    await screen.findByText('Royalti Depot Satu');
    expect(screen.queryByRole('button', { name: 'hq.partnerBills.detail.approve' })).toBeNull();
  });

  it('lets a bill stuck while sending be approved again, but not voided, and says so', async () => {
    get.mockResolvedValue({ ...draft, status: 'SENDING' });
    post.mockRejectedValueOnce(new FakeApiError(409, 'x', 'PARTNER_BILL_SENDING'));
    confirmMock.mockResolvedValue(true);
    const { default: Page } = await import('@/app/hq/partner-bills/detail/page');
    render(<Page />);
    expect(screen.queryByRole('button', { name: 'hq.partnerBills.detail.void' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'hq.partnerBills.detail.approve' }));
    expect(await screen.findByText('hq.partnerBills.detail.sending')).toBeTruthy();
  });

  it('marks a sent bill paid with the day and a reference, and then shows it as paid (HD-25)', async () => {
    const sent = { ...draft, status: 'SENT', sentAt: '2026-11-09T00:00:00Z', dueOn: '2026-11-23', paidAt: null, paidOn: null, paidRef: null };
    get.mockResolvedValue(sent);
    post.mockResolvedValue({});
    const { default: Page } = await import('@/app/hq/partner-bills/detail/page');
    const view = render(<Page />);
    expect(await screen.findByText(/hq\.partnerBills\.detail\.dueOn/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'hq.partnerBills.detail.markPaid' }));
    fireEvent.change(screen.getByLabelText('hq.partnerBills.detail.paidOnLabel'), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText('hq.partnerBills.detail.paidRefLabel'), { target: { value: ' TRF 1 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'hq.partnerBills.detail.markPaidConfirm' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/payout/api/v1/partner-bills/b1/paid', { paidOn: '2026-11-20', ref: 'TRF 1' }, true),
    );
    // Without a reference the body carries none; cancel closes the form.
    fireEvent.click(await screen.findByRole('button', { name: 'hq.partnerBills.detail.markPaid' }));
    fireEvent.change(screen.getByLabelText('hq.partnerBills.detail.paidRefLabel'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'hq.partnerBills.detail.markPaidConfirm' }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/payout/api/v1/partner-bills/b1/paid', { paidOn: '2026-11-20' }, true));
    fireEvent.click(await screen.findByRole('button', { name: 'hq.partnerBills.detail.markPaid' }));
    fireEvent.click(screen.getByRole('button', { name: 'hq.partnerBills.detail.voidCancel' }));
    expect(screen.queryByLabelText('hq.partnerBills.detail.paidOnLabel')).toBeNull();
    view.unmount();

    get.mockResolvedValue({ ...sent, paidAt: '2026-11-20T03:00:00Z', paidOn: '2026-11-20', paidRef: 'TRF 1' });
    render(<Page />);
    expect(await screen.findByText(/hq\.partnerBills\.detail\.paidOn.*TRF 1/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'hq.partnerBills.detail.markPaid' })).toBeNull();
  });

  it('hides the paid button from a reader, and the list shows Lunas on a paid bill', async () => {
    role.value = 'DIREKTUR';
    get.mockResolvedValue({ ...draft, status: 'SENT', dueOn: '2026-11-23', paidAt: null });
    const { default: Detail } = await import('@/app/hq/partner-bills/detail/page');
    const view = render(<Detail />);
    await screen.findByText('Royalti Depot Satu');
    expect(screen.queryByRole('button', { name: 'hq.partnerBills.detail.markPaid' })).toBeNull();
    view.unmount();
    get.mockResolvedValue([{ ...draft, status: 'SENT', paidAt: '2026-11-20T03:00:00Z' }]);
    const { default: List } = await import('@/app/hq/partner-bills/page');
    render(<List />);
    expect(await screen.findByText('hq.partnerBills.paid')).toBeTruthy();
  });

  it('shows a load error', async () => {
    get.mockRejectedValue(new Error('down'));
    const { default: Page } = await import('@/app/hq/partner-bills/detail/page');
    render(<Page />);
    expect(await screen.findByText('hq.partnerBills.loadError')).toBeTruthy();
  });
});
