// @vitest-environment jsdom
//
// The last five orphan routes. Four answer "give me this one row" and one writes a whole
// week; every one of them was built, guarded, and reachable from no screen.
//
//   GET admin    /tickets/:id                  the message thread nothing rendered
//   GET depot    /suppliers/:id                phone + registration date, on no screen
//   GET delivery /driver/settlement/:id        when it was verified, and over how many orders
//   GET delivery /deliveries/:id               the only one with no written reason at all
//   PUT depot    /shifts/bulk                  no multi-cell write existed to use it
//
// Each detail is its own component precisely so it can be tested: the pages they hang off
// need half a dozen contexts to render, and a card about money that cannot be tested is a
// card nobody can change safely.
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get }, ApiError: class extends Error {} }));

import { LocaleProvider } from '@/lib/locale-context';
import { TicketDetail } from '@/components/hq/ticket-detail';
import { SupplierDetail } from '@/components/dashboard/supplier-detail';
import { SettlementDetail } from '@/components/driver/settlement-detail';
import { DeliveryDetail } from '@/components/dashboard/delivery-detail';
import { copyWeekCells, shiftWeekStart } from '@/lib/roster-copy';

const show = (node: React.ReactElement) => render(node, { wrapper: LocaleProvider });

afterEach(() => vi.clearAllMocks());

describe('TicketDetail', () => {
  const TICKET = {
    id: 'tk1',
    subject: 'Galon bocor',
    customerRef: 'Budi',
    customerPhone: '81100000001',
    orderRef: 'ORD-9',
    priority: 'HIGH',
    status: 'OPEN',
    assigneeId: null,
    createdAt: '2026-08-20T02:00:00.000Z',
    messages: [
      {
        id: 'm1',
        authorType: 'CUSTOMER',
        body: 'Galonnya bocor',
        createdAt: '2026-08-20T02:00:00.000Z',
      },
      {
        id: 'm2',
        authorType: 'STAFF',
        body: 'Kami ganti hari ini',
        createdAt: '2026-08-20T03:00:00.000Z',
      },
    ],
  };

  beforeEach(() => get.mockReset().mockResolvedValue(TICKET));

  // The thread is the whole point: the list route already returns `messages`, and the queue
  // screen renders the subject, the badges and the customer — never the conversation.
  it('renders the message thread the list never showed', async () => {
    show(<TicketDetail ticketId="tk1" />);
    expect(await screen.findByText('Galonnya bocor')).toBeTruthy();
    expect(await screen.findByText('Kami ganti hari ini')).toBeTruthy();
    expect(get.mock.calls.some((c) => String(c[0]).includes('/tickets/tk1'))).toBe(true);
  });

  it('says so when a ticket has no messages yet', async () => {
    get.mockResolvedValue({ ...TICKET, messages: [] });
    show(<TicketDetail ticketId="tk1" />);
    expect(await screen.findByText('Belum ada pesan.')).toBeTruthy();
  });
});

describe('SupplierDetail', () => {
  const SUPPLIER = {
    id: 's1',
    depotId: 'd1',
    name: 'CV Tirta',
    code: 'TRT',
    contactPhone: '02112345',
    categories: ['galon', 'tutup'],
    onTimeRate: 0.92,
    createdAt: '2026-01-05T02:00:00.000Z',
  };

  beforeEach(() => get.mockReset().mockResolvedValue(SUPPLIER));

  it('shows the phone and the registration date the card never had', async () => {
    show(<SupplierDetail supplierId="s1" />);
    expect(await screen.findByText('02112345')).toBeTruthy();
    expect(await screen.findByText('92%')).toBeTruthy();
  });

  /*
   * null is not zero. A supplier with no completed purchase orders has no on-time rate
   * yet, and "0%" reads as a supplier that has never once delivered on time — the opposite
   * of "we do not know".
   */
  it('distinguishes "no data yet" from a zero on-time rate', async () => {
    get.mockResolvedValue({ ...SUPPLIER, onTimeRate: null });
    show(<SupplierDetail supplierId="s1" />);
    expect(await screen.findByText('Belum ada data')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });
});

describe('SettlementDetail', () => {
  const SETTLEMENT = {
    id: 'st1',
    shiftId: 'sh1',
    driverId: 'k1',
    depotId: 'd1',
    status: 'DISPUTED',
    orderIds: ['o1', 'o2', 'o3'],
    expectedAmount: 250000,
    depositedAmount: 238000,
    variance: -12000,
    chargedToDriver: true,
    note: 'Kurang Rp12.000, dicek ulang besok',
    verifiedBy: 'kasir-1',
    verifiedAt: '2026-08-20T11:00:00.000Z',
    createdAt: '2026-08-20T10:00:00.000Z',
  };

  beforeEach(() => get.mockReset().mockResolvedValue(SETTLEMENT));

  /*
   * Sign matters more here than anywhere: a negative variance is money the courier still
   * owes. Rendering the absolute value would show a shortfall and a surplus identically.
   */
  it('shows a shortfall as money out, and the cashier’s reason', async () => {
    const { container } = show(<SettlementDetail settlementId="st1" />);
    expect(await screen.findByText('Kurang Rp12.000, dicek ulang besok')).toBeTruthy();
    expect(container.textContent ?? '').toContain('−');
    expect(await screen.findByText('3')).toBeTruthy(); // orders covered
  });

  it('shows a surplus as money in', async () => {
    get.mockResolvedValue({ ...SETTLEMENT, variance: 5000, chargedToDriver: false, note: null });
    const { container } = show(<SettlementDetail settlementId="st1" />);
    await screen.findByText('Tidak');
    expect(container.textContent ?? '').toContain('+');
  });
});

describe('DeliveryDetail', () => {
  const DELIVERY = {
    id: 'dl1',
    orderId: 'o1',
    orderNumber: 'ORD-77',
    driverId: 'k1',
    depotId: 'd1',
    status: 'ON_DELIVERY',
    destinationAddress: 'Jl. Cikini 5',
    destinationLat: null,
    destinationLng: null,
    recipientPhone: '81100000002',
    codAmount: 60000,
    assignedAt: '2026-08-20T02:00:00.000Z',
  };

  beforeEach(() => get.mockReset().mockResolvedValue(DELIVERY));

  it('shows the address, the number and the cash to collect', async () => {
    show(<DeliveryDetail deliveryId="dl1" />);
    expect(await screen.findByText('Jl. Cikini 5')).toBeTruthy();
    expect(await screen.findByText('81100000002')).toBeTruthy();
    expect(get.mock.calls.some((c) => String(c[0]).includes('/deliveries/dl1'))).toBe(true);
  });

  /*
   * `null` and `0` both mean "no cash to collect". Printing "Rp 0" for a non-COD delivery
   * would have a dispatcher asking a courier for money that was never owed.
   */
  it('says "not COD" rather than Rp 0', async () => {
    get.mockResolvedValue({ ...DELIVERY, codAmount: null });
    show(<DeliveryDetail deliveryId="dl1" />);
    expect(await screen.findByText('Bukan COD')).toBeTruthy();
  });
});

describe('copyWeekCells (PUT /shifts/bulk)', () => {
  const staff = [
    { id: 'k1', name: 'Budi' },
    { id: 'k2', name: 'Sari' },
  ];

  const cell = (staffId: string, day: number, shift: string) => ({
    id: `${staffId}-${day}`,
    staffId,
    staffName: 'old name',
    day,
    shift,
  });

  it('copies the shifts of everyone still on the grid', () => {
    const out = copyWeekCells([cell('k1', 0, 'PAGI'), cell('k2', 1, 'SORE')] as never, staff);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ staffId: 'k1', day: 0, shift: 'PAGI' });
  });

  /*
   * OFF is not copied. The bulk write sets what it is given, so an OFF from last week
   * would overwrite a shift somebody has already entered for the new one — and all it
   * means is "nobody filled this in".
   */
  it('does not copy OFF over a week somebody has started filling in', () => {
    expect(copyWeekCells([cell('k1', 0, 'OFF')] as never, staff)).toEqual([]);
  });

  // A courier who has left is not on the grid, and must not be rostered back onto it.
  it('drops anyone no longer on the grid', () => {
    expect(copyWeekCells([cell('gone', 0, 'PAGI')] as never, staff)).toEqual([]);
  });

  // The label is denormalised onto the row; last week's copy of it may be stale.
  it('writes the current name, not the one stored last week', () => {
    const out = copyWeekCells([cell('k1', 0, 'PAGI')] as never, staff);
    expect(out[0]!.staffName).toBe('Budi');
  });
});

describe('shiftWeekStart', () => {
  // Built in UTC on purpose: a roster week is a calendar label, not an instant, and
  // deriving it from local time makes the answer depend on the operator's own clock.
  it('steps back exactly seven days', () => {
    expect(shiftWeekStart('2026-08-24', -1)).toBe('2026-08-17');
  });

  it('crosses a month boundary', () => {
    expect(shiftWeekStart('2026-09-07', -1)).toBe('2026-08-31');
  });
});
