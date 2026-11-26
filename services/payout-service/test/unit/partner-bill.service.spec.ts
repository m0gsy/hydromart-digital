import { PartnerBillService } from '../../src/application/services/partner-bill.service';
import type { CommissionBasisRow } from '../../src/application/ports/ledger.repository';
import type { NewPartnerBill } from '../../src/application/ports/partner-bill.repository';
import type { PartnerBillRecord } from '../../src/domain/partner-bill';
import {
  dayAfter,
  dayBefore,
  monthLabel,
  monthWindow,
  splitNote,
  stretchesOf,
} from '../../src/domain/partner-bill';

const PT_A = '00000000-0000-4000-8000-0000000000a1';
const PT_B = '00000000-0000-4000-8000-0000000000b1';
const HKP = '00000000-0000-4000-8000-0000000000c1';
const D1 = '00000000-0000-4000-8000-0000000000d1';
const D2 = '00000000-0000-4000-8000-0000000000d2';
const OWNER_1 = '00000000-0000-4000-8000-0000000000e1';
const OWNER_2 = '00000000-0000-4000-8000-0000000000e2';
const BANK = { bankName: 'BCA', bankAccountNumber: '123456', bankAccountHolder: 'PT Indowater' };

const basis = (depotId: string, commissionIdr: number, extra: Partial<CommissionBasisRow> = {}): CommissionBasisRow => ({
  depotId,
  commissionIdr,
  rows: 3,
  reversalRows: 0,
  reversalIdr: 0,
  ownerIds: [OWNER_1],
  ...extra,
});

function build(opts: {
  depots?: string[];
  spans?: { depotId: string; legalEntityId: string | null; from: string }[];
  basis?: (depotIds: readonly string[], from: Date, to: Date) => CommissionBasisRow[];
  live?: Record<string, PartnerBillRecord>;
  bank?: typeof BANK | null;
  racing?: boolean;
} = {}) {
  const created: NewPartnerBill[] = [];
  const ledger = {
    depotsWithCommission: jest.fn().mockResolvedValue(opts.depots ?? [D1]),
    commissionBasis: jest.fn(async (ids: readonly string[], from: Date, to: Date) =>
      opts.basis ? opts.basis(ids, from, to) : [basis(D1, 100000)],
    ),
  };
  const stored = new Map<string, PartnerBillRecord>(Object.entries(opts.live ?? {}));
  const bills = {
    findLive: jest.fn(async (entity: string, month: string) => stored.get(`${entity}|${month}`) ?? null),
    create: jest.fn(async (data: NewPartnerBill) => {
      created.push(data);
      return opts.racing ? null : ({ id: 'new-bill', ...data } as unknown as PartnerBillRecord);
    }),
    findById: jest.fn(async (id: string) => stored.get(id) ?? null),
    list: jest.fn().mockResolvedValue([]),
    listForOwner: jest.fn().mockResolvedValue([]),
    markSent: jest.fn(async (id: string) => ({ ...stored.get(id)!, status: 'SENT' }) as PartnerBillRecord),
    markVoid: jest.fn(async (id: string) => ({ ...stored.get(id)!, status: 'VOID' }) as PartnerBillRecord),
  };
  const sources = {
    entityTimeline: jest.fn().mockResolvedValue(
      opts.spans ?? [{ depotId: D1, legalEntityId: PT_A, from: '2026-10-01' }],
    ),
    entities: jest.fn(async (ids: readonly string[]) =>
      [
        { id: PT_A, name: 'PT Mitra A', kind: 'FRANCHISEE' },
        { id: PT_B, name: 'PT Mitra B', kind: 'FRANCHISEE' },
        { id: HKP, name: 'PT Operator', kind: 'OPERATOR' },
      ].filter((e) => ids.includes(e.id)),
    ),
    officialAccount: jest.fn().mockResolvedValue(opts.bank === undefined ? BANK : opts.bank),
    depotName: jest.fn(async (id: string) => (id === D1 ? 'Depot Satu' : 'Depot Dua')),
  };
  const notifier = { send: jest.fn().mockResolvedValue(undefined) };
  const svc = new PartnerBillService(ledger as never, bills as never, sources as never, notifier as never);
  return { svc, ledger, bills, sources, notifier, created, stored };
}

describe('PartnerBillService.generate', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-08T03:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it('refuses a malformed month and the month still running', async () => {
    const { svc, ledger } = build();
    await expect(svc.generate('2026-13')).rejects.toMatchObject({ code: 'PARTNER_BILL_MONTH_INVALID' });
    await expect(svc.generate('2026-11')).rejects.toMatchObject({ code: 'PARTNER_BILL_MONTH_NOT_CLOSED' });
    await expect(svc.generate('2027-01')).rejects.toMatchObject({ status: 409 });
    expect(ledger.depotsWithCommission).not.toHaveBeenCalled();
  });

  it('says plainly that nothing was commissioned: no depot with a commission row, no bill', async () => {
    const { svc, created } = build({ depots: [] });
    expect(await svc.generate('2026-10')).toEqual({
      month: '2026-10',
      made: 0,
      existing: 0,
      skippedZero: 0,
      unassigned: 0,
      commissionRows: 0,
    });
    expect(created).toHaveLength(0);
  });

  it('makes one draft per franchisee with a line per depot, over the whole WIB month', async () => {
    const { svc, created, ledger } = build({
      depots: [D1, D2],
      spans: [
        { depotId: D1, legalEntityId: PT_A, from: '2026-10-01' },
        { depotId: D2, legalEntityId: PT_A, from: '2026-10-01' },
      ],
      basis: () => [basis(D1, 100000.4), basis(D2, 50000, { reversalRows: 1, reversalIdr: 2500 })],
    });
    const result = await svc.generate('2026-10');
    expect(result).toMatchObject({ made: 1, existing: 0, skippedZero: 0, commissionRows: 6 });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ legalEntityId: PT_A, legalEntityName: 'PT Mitra A', month: '2026-10', totalIdr: 150000 });
    expect(created[0].lines.map((l) => l.amountIdr)).toEqual([100000, 50000]);
    expect(created[0].lines[1].label).toContain('koreksi pembatalan Rp2.500');
    expect(created[0].lines[0].basis).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    // The month is the WIB one: 1 Oct 00:00 WIB = 30 Sep 17:00Z, until 1 Nov 00:00 WIB.
    expect(ledger.commissionBasis).toHaveBeenCalledTimes(1);
    const [, from, to] = ledger.commissionBasis.mock.calls[0];
    expect((from as Date).toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect((to as Date).toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('bills a depot that changed entity mid-month once on each bill, for its own days', async () => {
    const { svc, created } = build({
      spans: [
        { depotId: D1, legalEntityId: PT_A, from: '2026-10-01' },
        { depotId: D1, legalEntityId: PT_B, from: '2026-10-15' },
      ],
      basis: (_ids, from) => [basis(D1, from.toISOString().startsWith('2026-09-30') ? 70000 : 30000)],
    });
    expect(await svc.generate('2026-10')).toMatchObject({ made: 2 });
    const byEntity = Object.fromEntries(created.map((c) => [c.legalEntityId, c]));
    expect(byEntity[PT_A].totalIdr).toBe(70000);
    expect(byEntity[PT_A].lines[0].label).toBe('Royalti Depot Satu (1 Okt - 14 Okt)');
    expect(byEntity[PT_B].totalIdr).toBe(30000);
    expect(byEntity[PT_B].lines[0].label).toBe('Royalti Depot Satu (15 Okt - 31 Okt)');
  });

  it('skips a month that nets to zero, ignores non-franchisee depots and counts depots with no entity', async () => {
    const { svc, created } = build({
      depots: [D1, D2],
      spans: [
        { depotId: D1, legalEntityId: PT_A, from: '2026-10-01' },
        { depotId: D2, legalEntityId: null, from: '2026-10-01' },
      ],
      basis: () => [basis(D1, 0), basis(D2, 9000)],
    });
    expect(await svc.generate('2026-10')).toMatchObject({ made: 0, skippedZero: 1, unassigned: 1 });
    const hkp = build({ spans: [{ depotId: D1, legalEntityId: HKP, from: '2026-10-01' }] });
    expect(await hkp.svc.generate('2026-10')).toMatchObject({ made: 0, skippedZero: 0 });
    expect(created).toHaveLength(0);
    expect(hkp.created).toHaveLength(0);
  });

  it('is idempotent: a live bill is counted, never doubled, and a lost race counts as existing', async () => {
    const live = { [`${PT_A}|2026-10`]: { id: 'b1' } as PartnerBillRecord };
    const again = build({ live });
    expect(await again.svc.generate('2026-10')).toMatchObject({ made: 0, existing: 1 });
    expect(again.created).toHaveLength(0);
    const race = build({ racing: true });
    expect(await race.svc.generate('2026-10')).toMatchObject({ made: 0, existing: 1 });
  });
});

describe('PartnerBillService approve, void and reads', () => {
  const draft = (extra: Partial<PartnerBillRecord> = {}): PartnerBillRecord =>
    ({
      id: 'b1',
      legalEntityName: 'PT Mitra A',
      month: '2026-10',
      status: 'DRAFT',
      totalIdr: 150000,
      recipientIds: [],
      lines: [{ id: 'l1', depotId: D1, label: 'x', amountIdr: 150000, basis: { from: '2026-10-01', to: '2026-10-31' } }],
      ...extra,
    }) as PartnerBillRecord;

  it('sends the bill to the owners behind its commission rows, then marks it sent', async () => {
    const t = build({ basis: () => [basis(D1, 1, { ownerIds: [OWNER_2, OWNER_1] })] });
    t.stored.set('b1', draft());
    const sent = await t.svc.approve('b1', 'finance-1');
    expect(sent.status).toBe('SENT');
    expect(t.notifier.send).toHaveBeenCalledWith(
      expect.objectContaining({
        billId: 'b1',
        monthLabel: 'Oktober 2026',
        totalIdr: 150000,
        bank: BANK,
        recipientIds: [OWNER_1, OWNER_2],
      }),
    );
    expect(t.bills.markSent).toHaveBeenCalledWith('b1', {
      approvedBy: 'finance-1',
      recipientIds: [OWNER_1, OWNER_2],
      bank: BANK,
    });
  });

  it('refuses to send without the official account, to nobody, twice, or a void bill', async () => {
    const noBank = build({ bank: null });
    noBank.stored.set('b1', draft());
    await expect(noBank.svc.approve('b1', 'f')).rejects.toMatchObject({ code: 'BANK_ACCOUNT_MISSING', status: 409 });
    expect(noBank.notifier.send).not.toHaveBeenCalled();

    const nobody = build({ basis: () => [] });
    nobody.stored.set('b1', draft());
    await expect(nobody.svc.approve('b1', 'f')).rejects.toMatchObject({ code: 'PARTNER_BILL_NO_RECIPIENTS' });

    const sent = build();
    sent.stored.set('b1', draft({ status: 'SENT' }));
    await expect(sent.svc.approve('b1', 'f')).rejects.toMatchObject({ code: 'PARTNER_BILL_NOT_DRAFT' });

    const voided = build();
    voided.stored.set('b1', draft({ status: 'VOID' }));
    await expect(voided.svc.approve('b1', 'f')).rejects.toMatchObject({ code: 'PARTNER_BILL_VOID' });
    await expect(voided.svc.approve('missing', 'f')).rejects.toMatchObject({ code: 'PARTNER_BILL_NOT_FOUND' });
  });

  it('loses a decision race cleanly, after the (idempotent) notice', async () => {
    const t = build();
    t.stored.set('b1', draft());
    t.bills.markSent.mockResolvedValueOnce(null as never);
    await expect(t.svc.approve('b1', 'f')).rejects.toMatchObject({ code: 'PARTNER_BILL_NOT_DRAFT' });
  });

  it('voids a draft or a sent bill with its reason, and only once', async () => {
    const t = build();
    t.stored.set('b1', draft({ status: 'SENT' }));
    expect((await t.svc.void('b1', ' salah badan hukum ', 'f')).status).toBe('VOID');
    expect(t.bills.markVoid).toHaveBeenCalledWith('b1', 'salah badan hukum');
    t.stored.set('b2', draft({ id: 'b2', status: 'VOID' }));
    await expect(t.svc.void('b2', 'again', 'f')).rejects.toMatchObject({ code: 'PARTNER_BILL_VOID' });
    t.stored.set('b3', draft({ id: 'b3' }));
    t.bills.markVoid.mockResolvedValueOnce(null as never);
    await expect(t.svc.void('b3', 'raced', 'f')).rejects.toMatchObject({ code: 'PARTNER_BILL_VOID' });
  });

  it('lists with its filter and reads one bill or an owner’s bills', async () => {
    const t = build();
    await t.svc.list({ month: '2026-10', status: 'SENT' });
    expect(t.bills.list).toHaveBeenCalledWith({ month: '2026-10', status: 'SENT' }, 200);
    await t.svc.forOwner(OWNER_1);
    expect(t.bills.listForOwner).toHaveBeenCalledWith(OWNER_1, 200);
    await expect(t.svc.get('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('partner bill dates', () => {
  it('reads a month in the WIB calendar', () => {
    expect(monthWindow('2026-02')).toMatchObject({ firstDay: '2026-02-01', lastDay: '2026-02-28' });
    expect(monthWindow('2026-12').lastDay).toBe('2026-12-31');
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
    expect(dayAfter('2026-10-31')).toBe('2026-11-01');
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
  });

  it('turns spans into closed stretches and names a split', () => {
    const stretches = stretchesOf(
      [
        { depotId: D1, legalEntityId: PT_B, from: '2026-10-15' },
        { depotId: D1, legalEntityId: PT_A, from: '2026-10-01' },
      ],
      '2026-10-31',
    );
    expect(stretches).toEqual([
      { depotId: D1, legalEntityId: PT_A, from: '2026-10-01', to: '2026-10-14' },
      { depotId: D1, legalEntityId: PT_B, from: '2026-10-15', to: '2026-10-31' },
    ]);
    expect(splitNote({ from: '2026-10-01', to: '2026-10-31' }, '2026-10-01', '2026-10-31')).toBe('');
    expect(splitNote({ from: '2026-10-15', to: '2026-10-31' }, '2026-10-01', '2026-10-31')).toBe(' (15 Okt - 31 Okt)');
  });
});
