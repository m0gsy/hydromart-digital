// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Five HR console screens.
 *
 *  - CA-1-51: a sentence with a `{workStartTime}` placeholder, called with no values, so
 *    the screen printed the token. It names the hours a depot without shifts runs on, and
 *    that is a per-depot setting somebody can change.
 *  - CA-1-72: one error state carried two different failures at two different moments, and
 *    both rendered at the top — so an import the server refused reported it thousands of
 *    pixels above the button that sent it.
 *  - CA-1-75: one authenticated, paged, depot-scoped query per keystroke.
 *  - CA-1-76: the only path that worked said nothing, and threw focus to <body>.
 *  - CA-1-78: two controls whose only name was a placeholder — which disappears the moment
 *    anything is typed.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], scopedId: null, ready: true, error: null, reload: vi.fn() }),
}));

import CalendarPage from '@/app/hr/calendar/page';
import EmployeesPage from '@/app/hr/employees/page';

const url = (c: unknown[]) => String(c[0]);

beforeEach(() => {
  vi.useRealTimers();
  get.mockReset().mockImplementation(async (u: string) => {
    if (u.includes('settings/schema')) return { defs: [], effective: { workStartTime: '07:30' } };
    if (u.includes('/employees')) return { rows: [], total: 0, page: 1, pageSize: 20 };
    return [];
  });
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('CA-1-51 the calendar states the real default, not its placeholder', () => {
  it('interpolates the depot workStartTime instead of printing the token', async () => {
    render(<CalendarPage />);
    // The value comes from the settings read, so the sentence can only be right if it asked.
    await waitFor(() =>
      expect(screen.getByText('hrFix.calendar.noShift:07:30')).toBeTruthy(),
    );
    expect(screen.queryByText(/\{workStartTime\}/)).toBeNull();
  });
});

describe('CA-1-75 the employee search does not fire per keystroke', () => {
  it('sends one query for a burst of typing, not one per letter', async () => {
    render(<EmployeesPage />);
    await waitFor(() => expect(get.mock.calls.some((c) => url(c).includes('/employees'))).toBe(true));

    const before = get.mock.calls.filter((c) => url(c).includes('/employees')).length;
    const box = screen.getByLabelText('hrFix.employees.searchHint');
    await userEvent.type(box, 'Budi');

    // Four letters used to be four authenticated, paged, depot-scoped queries.
    const during = get.mock.calls.filter((c) => url(c).includes('/employees')).length;
    expect(during - before).toBeLessThan(4);

    await waitFor(
      () =>
        expect(
          get.mock.calls.some((c) => url(c).includes('search=Budi')),
        ).toBe(true),
      { timeout: 2000 },
    );
  });
});

describe('CA-1-78 the filters carry names, not just placeholders', () => {
  it('names the employee search box for a screen reader', async () => {
    render(<EmployeesPage />);
    // `getByLabelText` is the assertion: a placeholder alone would not satisfy it.
    expect(screen.getByLabelText('hrFix.employees.searchHint')).toBeTruthy();
  });
});

describe('CA-1-72 an import failure appears beside the button that caused it', () => {
  it('keeps the file error and the submit error in two different places', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/csv-import.tsx', 'utf8');

    // One state served a file that could not be READ and an import the server REFUSED —
    // two failures at two moments, both rendered at the top of a screen that has a few
    // hundred preview rows in between.
    expect(src).toContain('const [submitError, setSubmitError]');
    const submitErrAt = src.indexOf('{submitError && (');
    const fileErrAt = src.indexOf('{fileError && (');
    const buttonAt = src.indexOf('onClick={submit}');
    expect(fileErrAt).toBeGreaterThan(-1);
    // The submit error now sits with the submit button, not with the file input.
    expect(submitErrAt).toBeGreaterThan(fileErrAt);
    expect(Math.abs(buttonAt - submitErrAt)).toBeLessThan(400);
    // And the message goes through the dictionary — it was an Indonesian literal inside
    // `setFileError()`, one of the i18n gate's blind spots (CA-2-47).
    expect(src).not.toContain("'Import gagal, coba lagi.'");
  });
});

describe('CA-1-76 minting a login says so, and does not throw focus away', () => {
  it('announces the success and hands focus back to the row', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/hr/employees/page.tsx', 'utf8');

    // The reload REMOVES this button — the employee now has a login — so success looked
    // exactly like a control quietly disappearing, and focus fell to <body>.
    expect(src).toContain('hrFix.employees.accountCreated');
    expect(src).toContain("closest('[data-employee-row]')?.querySelector('a')?.focus()");
    // The anchor it hands focus to has to actually be marked.
    expect(src).toContain('data-employee-row');
  });
});
