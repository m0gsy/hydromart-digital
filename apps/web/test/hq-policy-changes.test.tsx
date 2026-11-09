// @vitest-environment jsdom
//
// AAS-14. A security-policy or retention change waits for a SECOND super admin. This page is where
// they decide it: the requester sees their own request but cannot decide it.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, toast } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), toast: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, post },
  ApiError: class extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'me' } }) }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/policy-changes',
  useSearchParams: () => new URLSearchParams(),
}));

import HqPolicyChangesPage from '@/app/hq/policy-changes/page';

const change = (over: Record<string, unknown>) => ({
  id: 'c1',
  kind: 'SECURITY_POLICY',
  targetId: null,
  payload: { idleTimeoutMinutes: 60 },
  status: 'PENDING',
  requestedBy: 'other-admin',
  requestedAt: new Date(0).toISOString(),
  decidedBy: null,
  decisionNote: null,
  ...over,
});

describe('AAS-14 /hq/policy-changes', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    toast.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("lets another admin approve a pending change, then reloads", async () => {
    get.mockResolvedValue([change({})]);
    post.mockResolvedValue({});
    render(<HqPolicyChangesPage />);
    await userEvent.click(await screen.findByText('hq.policyChanges.approve'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]?.[0])).toContain('/policy-changes/c1/approve');
    expect(toast).toHaveBeenCalledWith('hq.policyChanges.approved', 'success');
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });

  it('rejects through its own route', async () => {
    get.mockResolvedValue([change({})]);
    post.mockResolvedValue({});
    render(<HqPolicyChangesPage />);
    await userEvent.click(await screen.findByText('hq.policyChanges.reject'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]?.[0])).toContain('/policy-changes/c1/reject');
  });

  it('shows the requester their own request but will not let them decide it', async () => {
    get.mockResolvedValue([change({ requestedBy: 'me' })]);
    render(<HqPolicyChangesPage />);
    const approve = (await screen.findByText('hq.policyChanges.approve')).closest('button')!;
    expect(approve.disabled).toBe(true);
    expect(screen.getByText('hq.policyChanges.own')).toBeTruthy();
  });

  it('says so when nothing is waiting, and keeps decided requests read-only', async () => {
    get.mockResolvedValue([]);
    const { unmount } = render(<HqPolicyChangesPage />);
    expect(await screen.findByText('hq.policyChanges.empty')).toBeTruthy();
    unmount();
    get.mockResolvedValue([change({ status: 'APPLIED', kind: 'RETENTION_POLICY', targetId: 'r-1' })]);
    render(<HqPolicyChangesPage />);
    expect(await screen.findByText('hq.policyChanges.APPLIED')).toBeTruthy();
    expect(screen.queryByText('hq.policyChanges.approve')).toBeNull();
  });

  it('reports a failed decision without crashing', async () => {
    get.mockResolvedValue([change({})]);
    post.mockRejectedValue(new Error('boom'));
    render(<HqPolicyChangesPage />);
    await userEvent.click(await screen.findByText('hq.policyChanges.approve'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('hq.policyChanges.actionError', 'error'));
  });
});
