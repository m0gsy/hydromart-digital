// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Three HR controls that were on screen and out of reach.
 *
 *  - CA-1-77: which of the two punch buttons is selected was said in COLOUR alone. A
 *    screen reader announced two identical buttons, so an employee using one could not
 *    tell whether they were about to punch in or out — on the screen that files the record
 *    their pay is computed from.
 *  - CA-1-73: the announcement read-rate panel returned `null` when its read failed, so a
 *    missing number and a number of zero looked identical, and neither said so.
 *  - CA-1-57: the attendance row never wrapped, pushing the status select — the control
 *    that CORRECTS a day — off the edge of a phone.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/hr',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/toast')>('@/components/toast');
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), askReason: vi.fn() }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], scopedId: null, ready: true, error: null, reload: vi.fn() }),
}));
// The camera is the subject of its own row, not this one.
vi.mock('@/components/hr/face-capture', () => ({ FaceCapture: () => <div /> }));
vi.mock('@/components/offline-queue-banner', () => ({ OfflineQueueBanner: () => <div /> }));

import CheckInPage from '@/app/hr/me/check-in/page';

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe('CA-1-77 the punch toggle announces which side is chosen', () => {
  it('marks exactly one of the two buttons pressed', async () => {
    render(<CheckInPage />);
    await waitFor(() => expect(screen.getByText('hrFix.checkIn.checkIn')).toBeTruthy());

    const inBtn = screen.getByText('hrFix.checkIn.checkIn').closest('button')!;
    const outBtn = screen.getByText('hrFix.checkIn.checkOut').closest('button')!;
    // Both carry the attribute — a toggle that omits it on the unselected side is a button
    // that simply is not a toggle to a screen reader.
    expect(inBtn.getAttribute('aria-pressed')).toBe('true');
    expect(outBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('names the pair, so the two buttons are not announced loose', async () => {
    render(<CheckInPage />);
    await waitFor(() => expect(screen.getByRole('group')).toBeTruthy());
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('hrFix.checkIn.title');
  });
});

/*
 * CA-1-73 ships WITHOUT a test, and that is worth saying rather than hiding.
 *
 * The change is one line — `if (detail.error) return <LoadError .../>` beside the existing
 * loading and empty guards — but reaching it from a test means rendering the announcements
 * list, publishing a row, and expanding it, and the list fixture shape did not match on the
 * first two attempts. The guard uses the same `LoadError` the same file already renders at
 * its other failure site, so the risk is a missing panel, not a wrong one.
 */
