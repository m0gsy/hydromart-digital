// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Three courier/manager screens, three ways work or money went unsaid.
 *
 *  - CA-4-34: the proof-of-delivery form had no exit. The only way out was the system back
 *    button, which left the page and took the photo, the typed recipient name and the drawn
 *    signature with it, silently — after a courier had already done the handover.
 *  - CA-4-41: `DecideApprovalDto` has always accepted a `note`; this screen sent
 *    `{ decision }` alone. A manager on a phone refused a cash shortfall or a deposit
 *    refund with no reason attached, and never saw the sentence the raiser wrote either.
 *  - CA-4-25: `INCENTIVE` was missing from the web union while payout-service has always
 *    written it, so the ladder bonus — the credit a courier is most likely to go looking
 *    for — rendered with a blank type label.
 */

const { get, post, patch, confirmFn, replaceFn, pushFn } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  confirmFn: vi.fn(),
  replaceFn: vi.fn(),
  pushFn: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch, put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushFn, replace: replaceFn, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/m/manager/approvals/detail',
  useSearchParams: () => new URLSearchParams('id=ap-1'),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'ap-1' }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: confirmFn }) }));
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ApprovalDetailPage from '@/app/m/manager/approvals/detail/page';
import { PodCapture } from '@/components/driver/pod-capture';
import EarningsHistoryPage from '@/app/driver/earnings/history/page';

const APPROVAL = {
  id: 'ap-1',
  depotId: 'depot-1',
  type: 'COD_SHORTFALL',
  status: 'PENDING',
  title: 'Setoran kurang',
  submittedBy: 'op-1',
  subjectRef: 'Andi',
  amountIdr: -45000,
  payload: {
    expected: 500000,
    received: 455000,
    note: 'Kurir bilang uangnya jatuh di jalan.',
  },
  autoPassThreshold: 20000,
  decisionNote: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-09-01T02:00:00.000Z',
};

beforeEach(() => {
  get.mockReset().mockResolvedValue(APPROVAL);
  patch.mockReset().mockResolvedValue({});
  post.mockReset().mockResolvedValue({});
  confirmFn.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.clearAllMocks());

describe('CA-4-41 deciding money from a phone', () => {
  it('shows the sentence the person who raised it wrote', async () => {
    render(<ApprovalDetailPage />);
    await waitFor(() => expect(screen.getByText('Kurir bilang uangnya jatuh di jalan.')).toBeTruthy());
  });

  it('refuses a rejection with no reason, and never reaches the server', async () => {
    render(<ApprovalDetailPage />);
    await waitFor(() => expect(screen.getByText('hrFix.approvalDetail.reject')).toBeTruthy());
    await userEvent.click(screen.getByText('hrFix.approvalDetail.reject'));
    await waitFor(() =>
      expect(screen.getByText('mgrFix.approvalDecide.rejectReasonRequired')).toBeTruthy(),
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends the note the manager typed', async () => {
    render(<ApprovalDetailPage />);
    await waitFor(() => expect(screen.getByText('hrFix.approvalDetail.reject')).toBeTruthy());
    await userEvent.type(
      screen.getByPlaceholderText('mgrFix.approvalDecide.notePlaceholder'),
      'Bukti tidak cukup',
    );
    await userEvent.click(screen.getByText('hrFix.approvalDetail.reject'));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[1]).toEqual({ decision: 'REJECT', note: 'Bukti tidak cukup' });
  });

  it('lets an approval through without one — the amount and the rule are already on record', async () => {
    render(<ApprovalDetailPage />);
    await waitFor(() => expect(screen.getByText('hrFix.approvalDetail.approve')).toBeTruthy());
    await userEvent.click(screen.getByText('hrFix.approvalDetail.approve'));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[1]).toEqual({ decision: 'APPROVE', note: undefined });
  });
});

describe('CA-4-34 the proof-of-delivery form has a way out', () => {
  const onCancel = vi.fn();
  const onDone = vi.fn();

  beforeEach(() => {
    onCancel.mockReset();
    onDone.mockReset();
    // The app's own dialog, not `window.confirm` — banned repo-wide (see
    // test/no-native-dialogs.test.ts) because Android's WebView suppresses it, which would
    // trap a courier in the very form this row is about.
    confirmFn.mockResolvedValue(true);
  });

  it('leaves straight away when nothing has been filled in', async () => {
    render(<PodCapture deliveryId="d1" orderNumber="HM-1" onDone={onDone} onCancel={onCancel} />);
    await userEvent.click(screen.getByText('hrFix.pod.cancel'));
    expect(onCancel).toHaveBeenCalled();
    // Nothing to lose, so nothing to ask about.
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('asks before throwing away a name the courier already typed', async () => {
    render(<PodCapture deliveryId="d1" orderNumber="HM-1" onDone={onDone} onCancel={onCancel} />);
    await userEvent.type(screen.getByPlaceholderText('hrFix.pod.recipientHint'), 'Ibu Sari');
    await userEvent.click(screen.getByText('hrFix.pod.cancel'));
    expect(confirmFn).toHaveBeenCalled();
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it('keeps the form when the courier says no', async () => {
    confirmFn.mockResolvedValue(false);
    render(<PodCapture deliveryId="d1" orderNumber="HM-1" onDone={onDone} onCancel={onCancel} />);
    await userEvent.type(screen.getByPlaceholderText('hrFix.pod.recipientHint'), 'Ibu Sari');
    await userEvent.click(screen.getByText('hrFix.pod.cancel'));
    await waitFor(() => expect(confirmFn).toHaveBeenCalled());
    expect(onCancel).not.toHaveBeenCalled();
    expect((screen.getByDisplayValue('Ibu Sari') as HTMLInputElement).value).toBe('Ibu Sari');
  });

  it('catches the Android back gesture instead of letting it leave the page', async () => {
    render(<PodCapture deliveryId="d1" orderNumber="HM-1" onDone={onDone} onCancel={onCancel} />);
    await userEvent.type(screen.getByPlaceholderText('hrFix.pod.recipientHint'), 'Ibu Sari');
    // The guard pushes one history entry while the form is dirty; back pops THAT, and the
    // question is asked instead of the page being abandoned.
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(confirmFn).toHaveBeenCalled());
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });
});

describe('CA-4-25 the ladder bonus has a label', () => {
  it('names an INCENTIVE row instead of leaving its type blank', async () => {
    get.mockResolvedValue({
      items: [
        {
          id: 'l1',
          courierId: 'c1',
          depotId: null,
          type: 'INCENTIVE',
          amount: 25000,
          description: 'Bonus 20 pengantaran',
          sourceRef: 'ladder:2026-09',
          occurredAt: '2026-09-01T02:00:00.000Z',
          createdAt: '2026-09-01T02:00:00.000Z',
        },
      ],
      total: 1,
    });
    render(<EarningsHistoryPage />);
    // The label shares its line with the date, so match the element, not the text node.
    await waitFor(() => expect(screen.getByText(/typeIncentive/)).toBeTruthy());
    // The bug: a blank label. The whole line has to name the type.
    expect(screen.getByText(/typeIncentive/).textContent).toContain('typeIncentive');
  });
});
