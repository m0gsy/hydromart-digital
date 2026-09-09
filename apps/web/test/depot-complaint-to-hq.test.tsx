// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-58 — a customer complaint was recorded in two systems that never saw each other.
 *
 * Head office keeps `support_tickets`. A depot keeps a `CUSTOMER_CONFLICT` row in its own
 * incident inbox. Nothing linked them and nothing could — a ticket had no way to name a
 * depot, and an incident had no way to hold a phone number — so a complaint taken at the
 * counter was invisible upstairs, and the customer's follow-up depended entirely on
 * whoever happened to be standing there.
 *
 * This covers the console's half: the one field that lets a complaint travel, shown only
 * where it means something, and the state of each complaint said out loud rather than left
 * to be assumed.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' }],
    selected: { id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' },
    scopedId: 'd-1',
    ready: true,
    error: null,
    reload: vi.fn(),
  }),
}));

import IncidentsPage from '@/app/dashboard/incidents/page';

/** The report form lives behind a toggle: open it the way an operator does. */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  render(<IncidentsPage />);
  await user.click(await screen.findByRole('button', { name: 'dashB.incidents.reportTitle' }));
}

const incident = (over: Record<string, unknown> = {}) => ({
  id: 'inc-1',
  depotId: 'd-1',
  type: 'CUSTOMER_CONFLICT',
  severity: 'MEDIUM',
  status: 'OPEN',
  title: 'Galon bocor saat diterima',
  description: null,
  reportedBy: 'staff-1',
  courierName: null,
  orderRef: null,
  customerPhone: null,
  hqTicketRef: null,
  resolutionNote: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: '2026-09-09T02:00:00.000Z',
  updatedAt: '2026-09-09T02:00:00.000Z',
  ...over,
});

function route(rows: unknown[]) {
  return (raw: unknown) => {
    const path = String(raw ?? '');
    if (path.includes('field-incidents')) return Promise.resolve([]);
    if (path.includes('incidents')) return Promise.resolve(rows);
    return Promise.resolve([]);
  };
}

beforeEach(() => {
  get.mockReset().mockImplementation(route([]));
  post.mockReset().mockResolvedValue({});
});

describe('CA-2-58 a depot complaint can reach head office', () => {
  it('asks for a number only on a complaint', async () => {
    const user = userEvent.setup();
    await openForm(user);

    // The form opens on GALLON_DAMAGE: a broken gallon has no complainant to call back.
    const type = await screen.findByLabelText('dashB.incidents.typeLabel');
    expect(screen.queryByLabelText('dashB.incidents.customerPhoneLabel')).toBeNull();

    await user.selectOptions(type, 'CUSTOMER_CONFLICT');
    expect(screen.getByLabelText('dashB.incidents.customerPhoneLabel')).toBeTruthy();
  });

  it('sends the number with the complaint, which is what makes the mirror possible', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.selectOptions(
      await screen.findByLabelText('dashB.incidents.typeLabel'),
      'CUSTOMER_CONFLICT',
    );
    await user.type(screen.getByLabelText('dashB.incidents.titleLabel'), 'Galon bocor');
    await user.type(screen.getByLabelText('dashB.incidents.customerPhoneLabel'), '081234567890');
    await user.click(screen.getByRole('button', { name: 'dashB.incidents.submitReport' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({
      type: 'CUSTOMER_CONFLICT',
      customerPhone: '081234567890',
    });
  });

  it('leaves the number out when the operator did not take one', async () => {
    const user = userEvent.setup();
    await openForm(user);

    await user.type(
      await screen.findByLabelText('dashB.incidents.titleLabel'),
      'Galon retak di gudang',
    );
    await user.click(screen.getByRole('button', { name: 'dashB.incidents.submitReport' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    // Undefined, not empty: the same shape the other optional fields use, and JSON drops it.
    expect((post.mock.calls[0]![1] as { customerPhone?: string }).customerPhone).toBeUndefined();
  });

  it('says which complaints reached head office, and which did not', async () => {
    // The two states looked identical before this, which is the whole defect: a complaint
    // that travelled and one that died in the depot were the same row on screen.
    get.mockImplementation(
      route([
        incident({ id: 'inc-1', hqTicketRef: 'tkt-9', customerPhone: '081234567890' }),
        incident({ id: 'inc-2', title: 'Antre lama' }),
      ]),
    );
    render(<IncidentsPage />);

    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());
    expect(screen.getByText('dashB.incidents.forwarded')).toBeTruthy();
    expect(screen.getByText('dashB.incidents.notForwarded')).toBeTruthy();
  });

  it('says nothing about forwarding on an incident that is not a complaint', async () => {
    // A courier's fall is depot operations. It has no upstairs to travel to, so a
    // "not sent" chip on it would be a false accusation of a missing step.
    get.mockImplementation(
      route([incident({ type: 'COURIER_FALL', title: 'Kurir terjatuh di Jl. Kemang' })]),
    );
    render(<IncidentsPage />);

    await waitFor(() => expect(screen.getByText(/Kurir terjatuh/)).toBeTruthy());
    expect(screen.queryByText('dashB.incidents.notForwarded')).toBeNull();
    expect(screen.queryByText('dashB.incidents.forwarded')).toBeNull();
  });
});
