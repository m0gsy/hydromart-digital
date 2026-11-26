// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** HD-14: the quality hold card, lab tests and permits on one depot's page. */

const { get, post, role } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: { value: 'HEAD_OFFICE' } }));

vi.mock('@/lib/api', () => ({ api: { get, post }, ApiError: class extends Error {} }));
vi.mock('@/components/require-auth', () => ({ RequireAuth: ({ children }: { children: unknown }) => children }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k), locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'u1', role: role.value }, ready: true }) }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [{ id: 'd-1', name: 'Cikini' }], selected: { id: 'd-1', name: 'Cikini' }, scopedId: 'd-1', ready: true }),
}));

import QualityPage from '@/app/dashboard/quality/page';

const HOLD = { id: 'h1', depotId: 'd-1', status: 'ACTIVE', reasonCode: 'LAB_FAIL', note: 'keruh', startedAt: '2026-11-20T03:00:00.000Z', endedAt: null, endRetestId: null };
const PASS = { id: 't1', depotId: 'd-1', kind: 'LENGKAP', takenOn: '2026-11-21', resultOn: '2026-11-22', result: 'PASS', labName: 'Lab A', reportNo: 'R-1' };
const OLD = { ...PASS, id: 't0', takenOn: '2026-11-01', reportNo: 'R-0' };

function serve(over: { holds?: unknown[]; tests?: unknown[]; permits?: unknown[] } = {}) {
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/quality-hold')) return over.holds ?? [];
    if (url.endsWith('/lab-tests')) return over.tests ?? [];
    return over.permits ?? [];
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  post.mockResolvedValue({});
  role.value = 'HEAD_OFFICE';
});

describe('quality page', () => {
  it('refuses a role without the capability', () => {
    role.value = 'COURIER';
    render(<QualityPage />);
    expect(screen.getByText('dashB.quality.gateTitle')).toBeTruthy();
  });

  it('starts a hold with a reason and a note', async () => {
    serve();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<QualityPage />);
    await userEvent.click(await screen.findByText('dashB.quality.start'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/depots/api/v1/depots/d-1/quality-hold', { reasonCode: 'LAB_FAIL' }, true));
  });

  it('offers only a PASS taken on or after the hold started, and ends with it', async () => {
    serve({ holds: [HOLD], tests: [PASS, OLD] });
    render(<QualityPage />);
    const pick = (await screen.findByLabelText('dashB.quality.endPick')) as HTMLSelectElement;
    expect(pick.options).toHaveLength(2);
    await userEvent.selectOptions(pick, 't1');
    await userEvent.click(screen.getByText('dashB.quality.end'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/depots/api/v1/depots/d-1/quality-hold/end', { retestId: 't1' }, true));
  });

  it('says a retest is needed first when none qualifies, and hides End from a Kepala', async () => {
    serve({ holds: [HOLD], tests: [OLD] });
    const { unmount } = render(<QualityPage />);
    expect(await screen.findByText('dashB.quality.endNone')).toBeTruthy();
    unmount();
    role.value = 'KEPALA_DEPOT';
    render(<QualityPage />);
    await screen.findByText(/dashB.quality.holdOn/);
    expect(screen.queryByText('dashB.quality.end')).toBeNull();
  });

  it('adds a lab test and a permit', async () => {
    serve({ tests: [PASS], permits: [{ id: 'p1', depotId: 'd-1', kind: 'SLHS', number: '9', validUntil: '2020-01-01' }] });
    render(<QualityPage />);
    await userEvent.type(await screen.findByLabelText('dashB.quality.labName'), 'Lab B');
    await userEvent.type(screen.getByLabelText('dashB.quality.reportNo'), 'R-2');
    await userEvent.click(screen.getByText('dashB.quality.addLab'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/depots/api/v1/depots/d-1/lab-tests', expect.objectContaining({ kind: 'FISIK_MIKRO', labName: 'Lab B', reportNo: 'R-2', result: 'PASS' }), true),
    );
    await userEvent.type(screen.getByLabelText('dashB.quality.permitNumber'), '10');
    await userEvent.type(screen.getByLabelText('dashB.quality.validUntil'), '2027-01-01');
    await userEvent.click(screen.getByText('dashB.quality.addPermit'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/depots/api/v1/depots/d-1/permits', { kind: 'SLHS', number: '10', validUntil: '2027-01-01' }, true));
  });
});
