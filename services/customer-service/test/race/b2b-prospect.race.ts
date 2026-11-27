import { AuthenticatedUser, Role } from '@hydromart/platform';

import { B2bProspectIntakeService, IntakeRow } from '../../src/application/services/b2b-prospect-intake.service';
import { B2bProspectPrismaRepository } from '../../src/infrastructure/prisma/b2b-prospect.prisma.repository';
import { buildTestConfig } from '../support/fakes';
import { describeRace, freshPrisma, race } from './db';

const user = { sub: '11111111-1111-4111-8111-111111111111', role: Role.MARKETING, phone: null, depotId: null } as unknown as AuthenticatedUser;

/*
 * The advisory lock + the unique indexes of b2b_prospects on a real Postgres: parallel writers of
 * the same business must leave exactly one row, and the losers must be refusals, not 500s.
 */
describeRace('B2B prospect writes on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: B2bProspectPrismaRepository;
  let intake: B2bProspectIntakeService;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new B2bProspectPrismaRepository(prisma as never);
    intake = new B2bProspectIntakeService(
      repo,
      { customerIdByPhone: async () => null } as never,
      { listActive: async () => [{ id: '22222222-2222-4222-8222-222222222222', lat: -6.5, lng: 6.001, serviceRadiusKm: 5 }] } as never,
      buildTestConfig(),
    );
  });
  afterAll(async () => drop?.());
  beforeEach(async () => {
    await prisma.b2bProspect.deleteMany();
    await prisma.b2bDoNotContact.deleteMany();
  });

  const field = (over: Partial<IntakeRow> = {}) => ({ name: 'Kos Melati', category: 'kos', lat: -6.5, lng: 6, phone: '0812-0000-0001', ...over });
  const outcomes = (res: PromiseSettledResult<unknown>[]) => ({
    ok: res.filter((r) => r.status === 'fulfilled').length,
    refused: res.filter((r) => r.status === 'rejected' && (r.reason as { reason?: string }).reason === 'DUPLICATE').length,
    other: res.filter((r) => r.status === 'rejected' && (r.reason as { reason?: string }).reason !== 'DUPLICATE').length,
  });

  it('5 parallel creates of the same phone leave one row and 4 DUPLICATE refusals', async () => {
    const res = await race(Array.from({ length: 5 }, (_, i) => () => intake.createField(user, field({ name: `Usaha ${i}` }))));
    expect(outcomes(res)).toEqual({ ok: 1, refused: 4, other: 0 });
    expect(await prisma.b2bProspect.count()).toBe(1);
  });

  it('parallel creates of the same name in the same cell leave one row', async () => {
    const res = await race(Array.from({ length: 5 }, (_, i) => () => intake.createField(user, field({ phone: `0812-0000-010${i}` }))));
    expect(outcomes(res)).toEqual({ ok: 1, refused: 4, other: 0 });
    expect(await prisma.b2bProspect.count()).toBe(1);
  });

  it('parallel imports of the same dataset row leave one row', async () => {
    const one = (i: number) => () =>
      intake.importFile(user, {
        dryRun: false,
        costIdr: 0,
        rows: [{ ...field({ name: `Usaha ${i}`, phone: `0812-0000-020${i}`, lat: -6.5 + i * 0.01 }), source: 'osm', license: 'ODbL-1.0', sourceId: 'node/1' }],
      });
    const res = await race([0, 1, 2, 3, 4].map(one));
    expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.b2bProspect.count()).toBe(1);
  });

  it('the same 50-row file committed twice in parallel leaves 50 rows', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      ...field({ name: `Kos ${i}`, phone: `0812-1${String(i).padStart(3, '0')}-000`, lat: -6.5 + i * 0.01 }),
      source: 'osm',
      license: 'ODbL-1.0',
      sourceId: `node/${i}`,
    }));
    const res = await race([() => intake.importFile(user, { dryRun: false, costIdr: 0, rows }), () => intake.importFile(user, { dryRun: false, costIdr: 0, rows })]);
    expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.b2bProspect.count()).toBe(50);
    expect(await prisma.b2bImportBatch.count()).toBe(2);
  });

  it('parallel do-not-contact writes of one key leave one entry', async () => {
    const entries = [{ kind: 'PHONE' as const, keyHash: 'h'.repeat(64) }];
    const res = await race(Array.from({ length: 5 }, () => () => repo.suppress({ phoneE164: '+6281200000001' }, entries, 'OTHER', user.sub, new Date())));
    expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.b2bDoNotContact.count()).toBe(1);
  });

  it('answers the coverage aggregates (raw SQL) on a real table', async () => {
    await intake.createField(user, field());
    const out = await repo.coverage({ includeCost: true });
    expect(out).toMatchObject({ total: 1, onMap: 0, thirdPartyCostIdr: 0 });
    expect(out.age).not.toBeNull();
    expect((await repo.coverage({ depotIds: ['22222222-2222-4222-8222-222222222222'], includeCost: false })).total).toBe(1);
  });
});
