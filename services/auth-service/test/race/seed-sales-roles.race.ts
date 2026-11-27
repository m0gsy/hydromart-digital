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

  const snapshot = async () => ({
    roles: await prisma.customRole.findMany({ orderBy: { key: 'asc' } }),
    caps: await prisma.capabilityOverride.findMany({ orderBy: { capability: 'asc' } }),
  });

  it('seeds both roles and running it again changes nothing', async () => {
    const first = await snapshot();
    expect(first.roles.map((r) => r.key)).toEqual(['C_sales', 'C_sales_lead']);
    expect(first.caps.find((c) => c.capability === 'prospectSettings')?.roles).toEqual([
      'SUPER_ADMIN',
      'C_sales_lead',
    ]);
    await prisma.$executeRawUnsafe(sql);
    expect(await snapshot()).toEqual(first);
  });

  it('leaves a hand-made C_sales exactly as it is, caps included', async () => {
    await prisma.capabilityOverride.deleteMany({});
    await prisma.customRole.deleteMany({ where: { key: 'C_sales_lead' } });
    await prisma.customRole.update({
      where: { key: 'C_sales' },
      data: { description: 'mine', archivedAt: new Date() },
    });
    await prisma.$executeRawUnsafe(sql);
    const { roles, caps } = await snapshot();
    expect(roles.find((r) => r.key === 'C_sales')?.description).toBe('mine');
    expect(caps.flatMap((c) => c.roles)).not.toContain('C_sales');
    expect(caps.find((c) => c.capability === 'prospectSettings')?.roles).toEqual([
      'SUPER_ADMIN',
      'C_sales_lead',
    ]);
  });
});
