import { DepotRecord } from '../../src/application/ports/depot.repository';
import { CustomerGallonRow } from '../../src/application/services/gallon-network.service';
import { GallonReminderService } from '../../src/application/services/gallon-reminder.service';

const DAY = 24 * 60 * 60 * 1000;
/** 09:00 WIB — when the scheduler's morning round runs. */
const NOW = new Date('2026-09-28T02:00:00.000Z');

const depot = (id: string, name = `Depot ${id}`) => ({ id, name }) as DepotRecord;

const late = (
  customerId: string,
  overdueGallons = 2,
  oldestIssuedAt: string | null = '2026-08-12T05:00:00.000Z',
): CustomerGallonRow => ({
  customerId,
  gallonsOnLoan: overdueGallons,
  depositHeldIdr: 40_000,
  overdueGallons,
  oldestIssuedAt,
});

interface Setup {
  /** Every active depot, in the order the repository pages them out. */
  depots?: DepotRecord[];
  /** Per-depot rows from the gallon ledger; a function to make one depot throw. */
  rows?: Record<string, CustomerGallonRow[] | Error>;
  /** customerId -> when they were last asked. */
  asked?: Record<string, Date>;
  /** customerId -> contact; absent = no number on file. */
  contacts?: Record<string, { name: string; phone: string } | Error>;
  /** Whether crm accepts the message. */
  accepts?: boolean | ((customerId: string) => boolean);
  everyDays?: number;
}

function build(s: Setup = {}) {
  const all = s.depots ?? [depot('d1')];
  const search = jest.fn(async ({ page, limit }: { page: number; limit: number }) => ({
    items: all.slice((page - 1) * limit, page * limit),
    total: all.length,
  }));
  const perCustomer = jest.fn(async (depotId: string) => {
    const rows = s.rows?.[depotId] ?? [];
    if (rows instanceof Error) throw rows;
    return rows;
  });
  const lastRemindedAt = jest.fn(async (_depotId: string, ids: readonly string[]) => {
    const found = new Map<string, Date>();
    for (const id of ids) {
      const at = s.asked?.[id];
      if (at) found.set(id, at);
    }
    return found;
  });
  const markReminded = jest.fn(async () => undefined);
  const resolve = jest.fn(async (customerId: string) => {
    const contact = s.contacts?.[customerId] ?? null;
    if (contact instanceof Error) throw contact;
    return contact;
  });
  const send = jest.fn(
    async (_event: string, _phone: string, customerId: string, _vars: Record<string, string>) =>
      typeof s.accepts === 'function' ? s.accepts(customerId) : (s.accepts ?? true),
  );
  const gallonReminderEveryDays = jest.fn(() => s.everyDays ?? 7);
  const service = new GallonReminderService(
    { search } as never,
    { perCustomer } as never,
    { lastRemindedAt, markReminded } as never,
    { resolve } as never,
    { send } as never,
    { gallonReminderEveryDays, businessTimeZone: 'Asia/Jakarta' } as never,
  );
  return { service, search, perCustomer, lastRemindedAt, markReminded, resolve, send, gallonReminderEveryDays };
}

const contact = (name = 'Budi') => ({ name, phone: '+62811' });

describe('GallonReminderService.sweep', () => {
  it('asks an overdue customer to bring the gallons back, and records that it asked', async () => {
    const { service, send, markReminded } = build({
      rows: { d1: [late('c1', 2)] },
      contacts: { c1: contact('Budi') },
    });

    await expect(service.sweep(NOW)).resolves.toEqual({
      attempted: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
      capped: false,
      ok: true,
    });
    expect(send).toHaveBeenCalledWith('GALLON_RETURN_REMINDER', '+62811', 'c1', {
      name: 'Budi',
      depot: 'Depot d1',
      gallons: '2',
      since: expect.stringMatching(/^12 \S+ 2026$/),
    });
    expect(markReminded).toHaveBeenCalledWith('d1', 'c1', NOW);
  });

  it('leaves customers who are not overdue alone', async () => {
    const { service, send, lastRemindedAt } = build({
      rows: { d1: [late('c1', 0), { ...late('c2', 0), oldestIssuedAt: null }] },
      contacts: { c1: contact(), c2: contact() },
    });
    await expect(service.sweep(NOW)).resolves.toMatchObject({ attempted: 0, sent: 0, ok: true });
    expect(send).not.toHaveBeenCalled();
    // …and does not even ask the reminder table about nobody.
    expect(lastRemindedAt).not.toHaveBeenCalled();
  });

  describe('not asking the same person every morning', () => {
    it('skips a customer asked more recently than the depot interval', async () => {
      const { service, send } = build({
        rows: { d1: [late('c1')] },
        contacts: { c1: contact() },
        asked: { c1: new Date(NOW.getTime() - 3 * DAY) },
        everyDays: 7,
      });
      await expect(service.sweep(NOW)).resolves.toMatchObject({ attempted: 0, sent: 0, skipped: 1 });
      expect(send).not.toHaveBeenCalled();
    });

    it('asks again once the interval has passed — exactly on the boundary counts', async () => {
      const { service, send } = build({
        rows: { d1: [late('c1')] },
        contacts: { c1: contact() },
        asked: { c1: new Date(NOW.getTime() - 7 * DAY) },
        everyDays: 7,
      });
      await expect(service.sweep(NOW)).resolves.toMatchObject({ sent: 1 });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('reads the interval from each depot’s own setting', async () => {
      const { service, gallonReminderEveryDays } = build({
        depots: [depot('d1'), depot('d2')],
        rows: { d1: [late('c1')], d2: [late('c2')] },
        contacts: { c1: contact(), c2: contact() },
      });
      await service.sweep(NOW);
      expect(gallonReminderEveryDays).toHaveBeenCalledWith('d1');
      expect(gallonReminderEveryDays).toHaveBeenCalledWith('d2');
    });
  });

  describe('when the reminder cannot go out', () => {
    it('skips a customer with no number on file, and does NOT record having asked', async () => {
      const { service, send, markReminded } = build({ rows: { d1: [late('c1')] } });
      await expect(service.sweep(NOW)).resolves.toMatchObject({ attempted: 1, skipped: 1, sent: 0, failed: 0 });
      expect(send).not.toHaveBeenCalled();
      expect(markReminded).not.toHaveBeenCalled();
    });

    // A reminder that never left must not start a seven-day silence: the customer would not be
    // asked again for a week because of an outage they never saw.
    it('counts a refused message as failed and does NOT record having asked', async () => {
      const { service, markReminded } = build({
        rows: { d1: [late('c1')] },
        contacts: { c1: contact() },
        accepts: false,
      });
      await expect(service.sweep(NOW)).resolves.toMatchObject({ sent: 0, failed: 1, ok: false });
      expect(markReminded).not.toHaveBeenCalled();
    });

    it('carries on past a customer whose lookup blows up', async () => {
      const { service } = build({
        rows: { d1: [late('c1'), late('c2')] },
        contacts: { c1: new Error('customer-service down'), c2: contact() },
      });
      await expect(service.sweep(NOW)).resolves.toMatchObject({ attempted: 2, sent: 1, failed: 1, ok: true });
    });

    it('carries on past a depot whose ledger cannot be read', async () => {
      const { service, send } = build({
        depots: [depot('bad'), depot('good')],
        rows: { bad: new Error('db down'), good: [late('c1')] },
        contacts: { c1: contact() },
      });
      await expect(service.sweep(NOW)).resolves.toMatchObject({ sent: 1, failed: 1, ok: true });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('reports the round as not ok when everything failed and nothing was sent', async () => {
      const { service } = build({ rows: { d1: new Error('db down') } });
      await expect(service.sweep(NOW)).resolves.toMatchObject({ sent: 0, failed: 1, ok: false });
    });
  });

  it('writes a placeholder rather than "undefined" when the oldest date is missing', async () => {
    const { service, send } = build({
      rows: { d1: [late('c1', 1, null)] },
      contacts: { c1: contact() },
    });
    await service.sweep(NOW);
    expect(send.mock.calls[0]?.[3]).toMatchObject({ since: '-' });
  });

  it('is quiet — and ok — when nobody is overdue anywhere', async () => {
    const { service } = build({ depots: [depot('d1'), depot('d2')] });
    await expect(service.sweep(NOW)).resolves.toEqual({
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      capped: false,
      ok: true,
    });
  });

  it('defaults to the present when no clock is passed', async () => {
    const { service, markReminded } = build({
      rows: { d1: [late('c1')] },
      contacts: { c1: contact() },
    });
    const before = Date.now();
    await service.sweep();
    const at = (markReminded.mock.calls[0] as unknown as [string, string, Date])[2];
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
  });

  describe('paging through depots', () => {
    it('reads every page of active depots', async () => {
      const many = Array.from({ length: 101 }, (_, i) => depot(`d${i}`));
      const { service, search, perCustomer } = build({ depots: many });
      await service.sweep(NOW);
      expect(search).toHaveBeenCalledTimes(2);
      expect(search).toHaveBeenNthCalledWith(1, { page: 1, limit: 100, activeOnly: true });
      expect(perCustomer).toHaveBeenCalledTimes(101);
    });

    it('stops after a full last page rather than looping forever', async () => {
      const exact = Array.from({ length: 100 }, (_, i) => depot(`d${i}`));
      const { service, search } = build({ depots: exact });
      await service.sweep(NOW);
      // A full page cannot say it is the last one, so one more (empty) read settles it.
      expect(search).toHaveBeenCalledTimes(2);
    });
  });

  describe('the per-round cap', () => {
    const crowd = (n: number) => Array.from({ length: n }, (_, i) => late(`c${i}`));
    const contactsFor = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, contact()]));

    it('stops inside a depot at 500 and leaves the rest for tomorrow', async () => {
      const { service, send } = build({ rows: { d1: crowd(501) }, contacts: contactsFor(501) });
      await expect(service.sweep(NOW)).resolves.toMatchObject({ attempted: 500, sent: 500, capped: true });
      expect(send).toHaveBeenCalledTimes(500);
    });

    it('does not start another depot once the cap is reached', async () => {
      const { service, perCustomer } = build({
        depots: [depot('d1'), depot('d2')],
        rows: { d1: crowd(500), d2: [late('other')] },
        contacts: { ...contactsFor(500), other: contact() },
      });
      await expect(service.sweep(NOW)).resolves.toMatchObject({ attempted: 500, capped: true });
      expect(perCustomer).toHaveBeenCalledTimes(1);
    });
  });
});
