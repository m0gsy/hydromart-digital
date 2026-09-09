// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-1-23 — a depot's own holiday or shift could be read, and never written.
 *
 * Both lists on this screen already say which rows belong to one depot and which are
 * network-wide. The API takes a `depotId` on both creates, and hr-service already limits a
 * depot-scoped caller to their own depot. Only the console never offered the choice — so
 * every holiday HR added was national and every shift was global. A closure for one town,
 * or a night shift only one depot runs, was a thing the screen could describe but not make.
 */

const { get, post, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
}));

const DEPOTS = [
  { id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' },
  { id: 'd-2', code: 'BGR-01', name: 'Bogor' },
];

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: DEPOTS, scopedId: null, ready: true, error: null, reload: vi.fn() }),
}));

import CalendarPage from '@/app/hr/calendar/page';

const HOLIDAYS = [
  { id: 'h-1', date: '2026-08-17', name: 'HUT RI', depotId: null },
  { id: 'h-2', date: '2026-09-01', name: 'Panen raya', depotId: 'd-2' },
];
const SHIFTS = [{ id: 's-1', name: 'Malam', startTime: '22:00', endTime: '06:00', active: true, depotId: 'd-2' }];

beforeEach(() => {
  get.mockReset().mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('holiday')
        ? HOLIDAYS
        : path.includes('shift')
          ? SHIFTS
          : { effective: { workStartTime: '08:00' } },
    ),
  );
  post.mockReset().mockResolvedValue({ id: 'new' });
  toast.mockReset();
});

describe('CA-1-23 the calendar can make what it can show', () => {
  it('sends the chosen depot with a new holiday', async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(screen.getByText(/HUT RI/)).toBeTruthy());

    const [date] = screen.getAllByLabelText(/hrFix\.calendar\.date/) as HTMLInputElement[];
    await userEvent.type(date!, '2026-12-25');
    const [name] = screen.getAllByLabelText(/hrFix\.calendar\.name/) as HTMLInputElement[];
    await userEvent.type(name!, 'Libur depot');
    const [scope] = screen.getAllByLabelText(/hrFix\.calendar\.scope\b/) as HTMLSelectElement[];
    await userEvent.selectOptions(scope!, 'd-2');
    await userEvent.click(screen.getAllByRole('button', { name: 'hrFix.calendar.add' })[0]!);

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toMatchObject({ name: 'Libur depot', depotId: 'd-2' });
  });

  it('leaves a network-wide holiday network-wide, with no depot at all', async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(screen.getByText(/HUT RI/)).toBeTruthy());

    const [date] = screen.getAllByLabelText(/hrFix\.calendar\.date/) as HTMLInputElement[];
    await userEvent.type(date!, '2026-12-25');
    const [name] = screen.getAllByLabelText(/hrFix\.calendar\.name/) as HTMLInputElement[];
    await userEvent.type(name!, 'Natal');
    await userEvent.click(screen.getAllByRole('button', { name: 'hrFix.calendar.add' })[0]!);

    await waitFor(() => expect(post).toHaveBeenCalled());
    // Absent, not null: the server reads "no depotId" as national, and a null would be a
    // different request than the one this form used to send.
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('depotId');
  });

  it('sends the chosen depot with a new shift', async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(screen.getByText(/Malam/)).toBeTruthy());

    const names = screen.getAllByLabelText(/hrFix\.calendar\.name/) as HTMLInputElement[];
    await userEvent.type(names[names.length - 1]!, 'Shift malam');
    const scopes = screen.getAllByLabelText(/hrFix\.calendar\.scope\b/) as HTMLSelectElement[];
    await userEvent.selectOptions(scopes[scopes.length - 1]!, 'd-1');
    const adds = screen.getAllByRole('button', { name: 'hrFix.calendar.add' });
    await userEvent.click(adds[adds.length - 1]!);

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toMatchObject({ name: 'Shift malam', depotId: 'd-1' });
  });

  it('says WHICH depot a scoped row belongs to, not just that it has one', async () => {
    render(<CalendarPage />);
    await waitFor(() => expect(screen.getByText(/HUT RI/)).toBeTruthy());

    // The depot code a human reads, on both lists.
    expect(screen.getAllByText(/hrFix\.calendar\.depotNamed:BGR-01/).length).toBeGreaterThan(1);
  });
});
