import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeRace, freshPrisma } from './db';

const sql = readFileSync(
  join(__dirname, '../../prisma/migrations/20261127100000_seed_sales_roles/migration.sql'),
  'utf8',
);

describeRace('seed_sales_roles migration on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];

  beforeAll(async () => {
    const db = await freshPrisma(); // `migrate deploy` has already run the seed once
    drop = db.drop;
    prisma = db.prisma;
  });
  afterAll(async () => drop?.());

  const run = () => prisma.$executeRawUnsafe(sql);
  const role = (key: string, archived = false, description: string | null = null) =>
    prisma.customRole.create({
      data: {
        key,
        name: key,
        description,
        scope: 'LOCKED',
        archivedAt: archived ? new Date() : null,
      },
    });
  const caps = async () => prisma.capabilityOverride.findMany({ orderBy: { capability: 'asc' } });
  /** Every (capability, C_* role) pair in the matrix, sorted, duplicates kept. */
  const pairs = async () =>
    (await caps())
      .flatMap((c) => c.roles.filter((r) => r.startsWith('C_')).map((r) => `${c.capability}:${r}`))
      .sort();
  const rolesOf = async (capability: string) =>
    (await caps()).find((c) => c.capability === capability)?.roles;

  const LEAD = [
    'prospectCrm:C_sales_lead',
    'prospectRead:C_sales_lead',
    'prospectSettings:C_sales_lead',
  ];
  const SALES = ['prospectCrm:C_sales', 'prospectRead:C_sales'];

  beforeEach(async () => {
    await prisma.capabilityOverride.deleteMany({});
    await prisma.capabilityDepotOverride.deleteMany({});
    await prisma.customRole.deleteMany({});
  });

  it('seeds both roles and running it again changes nothing', async () => {
    await run();
    const first = {
      roles: await prisma.customRole.findMany({ orderBy: { key: 'asc' } }),
      caps: await caps(),
    };
    expect(first.roles.map((r) => r.key)).toEqual(['C_sales', 'C_sales_lead']);
    expect(await pairs()).toEqual([...SALES, ...LEAD].sort());
    expect(await rolesOf('prospectSettings')).toEqual(['SUPER_ADMIN', 'C_sales_lead']);
    await run();
    expect({
      roles: await prisma.customRole.findMany({ orderBy: { key: 'asc' } }),
      caps: await caps(),
    }).toEqual(first);
  });

  it('leaves a hand-made archived C_sales exactly as it is and seeds only Lead', async () => {
    await role('C_sales', true, 'mine');
    await run();
    expect((await prisma.customRole.findUnique({ where: { key: 'C_sales' } }))?.description).toBe(
      'mine',
    );
    expect(await pairs()).toEqual([...LEAD].sort());
  });

  it('appends Lead once to existing override rows and keeps a hand-made active C_sales and its caps', async () => {
    await role('C_sales', false, 'mine');
    await prisma.capabilityOverride.create({
      data: { capability: 'prospectRead', roles: ['MARKETING', 'C_sales'] },
    });
    await prisma.capabilityOverride.create({
      data: { capability: 'prospectCrm', roles: ['DIREKTUR'] },
    });
    await run();
    await run();
    expect((await prisma.customRole.findUnique({ where: { key: 'C_sales' } }))?.description).toBe(
      'mine',
    );
    expect(await rolesOf('prospectRead')).toEqual(['MARKETING', 'C_sales', 'C_sales_lead']);
    expect(await rolesOf('prospectCrm')).toEqual(['DIREKTUR', 'C_sales_lead']);
    expect(await rolesOf('prospectSettings')).toEqual(['SUPER_ADMIN', 'C_sales_lead']);
    expect(await pairs()).toEqual(['prospectRead:C_sales', ...LEAD].sort());
  });

  it('gives a hand-made archived C_sales_lead no grants', async () => {
    await role('C_sales_lead', true);
    await run();
    expect(await pairs()).toEqual([...SALES].sort());
  });
});
