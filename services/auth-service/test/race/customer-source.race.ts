import { Role } from '../../src/domain/customer/role.enum';
import { CustomerPrismaRepository } from '../../src/infrastructure/prisma/repositories/customer.prisma.repository';
import { describeRace, freshPrisma } from './db';

/**
 * HD-8 on a real schema: the migration's columns exist, a signup's campaign codes are written,
 * read back for the data export, and a longer code than the column holds is refused by the
 * database itself (the DTO refuses it first; this is what stands behind the DTO).
 */
describeRace('customer campaign codes on real Postgres (HD-8)', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: CustomerPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new CustomerPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const phone = () => `+628${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;

  it('writes both codes and reads them back', async () => {
    const created = await repo.create({
      phone: phone(),
      email: null,
      fullName: null,
      role: Role.CUSTOMER,
      firstSource: 'pameran-bandung-2027',
      lastSource: 'qr-depot-bdg01',
    });
    const found = await repo.findById(created.id);
    expect(found?.firstSource).toBe('pameran-bandung-2027');
    expect(found?.lastSource).toBe('qr-depot-bdg01');
  });

  it('leaves both null for an account that carried none', async () => {
    const created = await repo.create({ phone: phone(), email: null, fullName: null, role: Role.CUSTOMER });
    const found = await repo.findById(created.id);
    expect(found?.firstSource).toBeNull();
    expect(found?.lastSource).toBeNull();
  });

  it('keeps the codes when the account is saved for something else', async () => {
    const created = await repo.create({
      phone: phone(),
      email: null,
      fullName: null,
      role: Role.CUSTOMER,
      firstSource: 'pameran',
      lastSource: 'meta-iklan',
    });
    created.updateProfile('Budi', undefined);
    await repo.save(created);
    const found = await repo.findById(created.id);
    expect(found?.fullName).toBe('Budi');
    expect(found?.firstSource).toBe('pameran');
  });

  it('refuses a code longer than the column', async () => {
    await expect(
      repo.create({
        phone: phone(),
        email: null,
        fullName: null,
        role: Role.CUSTOMER,
        firstSource: 'x'.repeat(65),
      }),
    ).rejects.toThrow();
  });
});
