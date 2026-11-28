import { WaCapPrismaRepository } from '../../src/infrastructure/prisma/wa-cap.prisma.repository';
import { WaConsentPrismaRepository } from '../../src/infrastructure/prisma/wa-consent.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

/*
 * HD-12 on real Postgres: the cap reservation is ONE conditional UPDATE, and a code claim is ONE conditional
 * UPDATE. The unit specs pin their shape; these prove the database serialises the writers.
 */
describeRace('WhatsApp caps and opt-in codes on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let caps: WaCapPrismaRepository;
  let consent: WaConsentPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    caps = new WaCapPrismaRepository(prisma as never);
    consent = new WaConsentPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const ok = (res: PromiseSettledResult<unknown>[]) =>
    res.filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok).length;

  it('20 parallel reservations against a cap of 5 reserve exactly 5, and the 80% warning is won once', async () => {
    await caps.upsertCap('1', 'UTILITY', { monthlyMessages: 5, rateIdr: null, monthlyCostIdr: null }, 'u');
    const res = await race(Array.from({ length: 20 }, () => () => caps.reserve('1', '2026-11', 'UTILITY')));
    expect(ok(res)).toBe(5);
    const row = await prisma.waCostCounter.findUniqueOrThrow({
      where: { waNumber_monthKey_category: { waNumber: '1', monthKey: '2026-11', category: 'UTILITY' } },
    });
    expect(row.messages).toBe(5);
    const warned = await race(Array.from({ length: 10 }, () => () => caps.markWarned('1', '2026-11', 'UTILITY', new Date())));
    expect(warned.filter((r) => r.status === 'fulfilled' && r.value === true)).toHaveLength(1);
  });

  it('a released slot can be reserved again, and the month rolls over by its key', async () => {
    await caps.release('1', '2026-11', 'UTILITY');
    expect(ok(await race([() => caps.reserve('1', '2026-11', 'UTILITY'), () => caps.reserve('1', '2026-11', 'UTILITY')]))).toBe(1);
    expect((await caps.reserve('1', '2026-12', 'UTILITY')).ok).toBe(true);
  });

  it('with no cap row, or paused, nothing is reserved', async () => {
    expect(await caps.reserve('1', '2026-11', 'MARKETING')).toEqual({ ok: false, reason: 'CAP' });
    await caps.upsertCap('1', 'MARKETING', { monthlyMessages: 5, rateIdr: null, monthlyCostIdr: null }, 'u');
    await caps.setPausedAll('1', true, 'u');
    expect(await caps.reserve('1', '2026-11', 'MARKETING')).toEqual({ ok: false, reason: 'PAUSED' });
  });

  it('the cost cap only counts when a rate is set', async () => {
    await caps.upsertCap('1', 'AUTHENTICATION', { monthlyMessages: 100, rateIdr: 400, monthlyCostIdr: 1000 }, 'u');
    expect(ok(await race(Array.from({ length: 6 }, () => () => caps.reserve('1', '2026-11', 'AUTHENTICATION'))))).toBe(2);
    await caps.upsertCap('1', 'SERVICE', { monthlyMessages: 3, rateIdr: null, monthlyCostIdr: 1 }, 'u');
    expect(ok(await race(Array.from({ length: 6 }, () => () => caps.reserve('1', '2026-11', 'SERVICE'))))).toBe(3);
  });

  it('purge keeps a phone with any purpose ending in a STOP, even when a newer grant exists, and deletes the rest', async () => {
    const old = new Date('2020-01-01T00:00:00.000Z');
    const row = (phone: string, purpose: string, granted: boolean, waNumber: string, ref: string) =>
      consent.append({ phone, customerId: null, waNumber, purpose, legalEntity: 'PT', granted, textVersion: 'v', source: waNumber === '2' ? 'AIWEB' : 'APP', sourceRef: ref, depotId: null, recordedAt: old });
    await row('6281500000001', 'MARKETING', false, '2', 'p1');
    await row('6281500000001', 'UTILITY', true, '1', 'p2');
    await row('6281500000002', 'UTILITY', true, '1', 'p3');
    await consent.purgeBefore(new Date('2021-01-01T00:00:00.000Z'));
    expect(await prisma.waConsent.count({ where: { phone: '6281500000001' } })).toBe(2);
    expect(await prisma.waConsent.count({ where: { phone: '6281500000002' } })).toBe(0);
  });

  it('two numbers claiming one opt-in code at once: exactly one wins', async () => {
    await consent.createCode({ code: 'RACE2345', kind: 'SELF', customerId: null, depotId: null, createdBy: 'u', expiresAt: new Date(Date.now() + 60_000) });
    const res = await race(['6281000000001', '6281000000002', '6281000000003'].map((p) => () => consent.claimCode('RACE2345', p, new Date())));
    expect(res.filter((r) => r.status === 'fulfilled' && r.value !== null)).toHaveLength(1);
  });
});
