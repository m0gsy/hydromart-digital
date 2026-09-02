import { Role } from '../../src/domain/customer/role.enum';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CustomerPrismaRepository } from '../../src/infrastructure/prisma/repositories/customer.prisma.repository';
import { OtpTokenPrismaRepository } from '../../src/infrastructure/prisma/repositories/otp-token.prisma.repository';
import { RefreshTokenPrismaRepository } from '../../src/infrastructure/prisma/repositories/refresh-token.prisma.repository';
import { AuditLogPrismaRepository } from '../../src/infrastructure/prisma/repositories/audit-log.prisma.repository';
import { CapabilityOverridePrismaRepository } from '../../src/infrastructure/prisma/repositories/capability-override.prisma.repository';
import { Customer } from '../../src/domain/customer/customer.entity';

const customerRow = () => ({
  id: 'cust-1',
  phone: '+6281234567890',
  email: 'budi@x.com',
  fullName: 'Budi',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  googleSub: null,
  avatarUrl: null,
  assignedDepotId: null,
  vehicleType: null,
  plateNumber: null,
  phoneVerifiedAt: new Date('2026-01-01'),
  lastLoginAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
});

describe('CustomerPrismaRepository', () => {
  const model = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { customer: model } as unknown as PrismaService;
  const repo = new CustomerPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('maps a persisted row to a domain entity', async () => {
    model.findUnique.mockResolvedValue(customerRow());
    const customer = await repo.findById('cust-1');
    expect(customer?.role).toBe(Role.CUSTOMER);
    expect(customer?.status).toBe(CustomerStatus.ACTIVE);
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'cust-1' } });
  });

  it('returns null when not found', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findByPhone('+62800')).toBeNull();
    expect(await repo.findByEmail('x@x.com')).toBeNull();
    expect(await repo.findByGoogleSub('sub')).toBeNull();
  });

  it('creates a customer with the mapped role', async () => {
    model.create.mockResolvedValue(customerRow());
    await repo.create({
      phone: '+6281234567890',
      email: null,
      fullName: null,
      role: Role.CUSTOMER,
    });
    expect(model.create).toHaveBeenCalledWith({
      data: {
        phone: '+6281234567890',
        email: null,
        fullName: null,
        role: 'CUSTOMER',
        assignedDepotId: null,
        vehicleType: null,
        plateNumber: null,
      },
    });
  });

  it('persists entity mutations via update', async () => {
    model.update.mockResolvedValue(customerRow());
    const customer = Customer.fromPersistence({
      ...customerRow(),
      role: Role.CUSTOMER,
      status: CustomerStatus.ACTIVE,
    });
    await repo.save(customer);
    expect(model.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-1' },
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });
});

describe('OtpTokenPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma = { otpToken: model } as unknown as PrismaService;
  const repo = new OtpTokenPrismaRepository(prisma);
  const otpRow = {
    id: 'otp-1',
    customerId: 'cust-1',
    purpose: 'LOGIN',
    codeHash: 'hashed',
    expiresAt: new Date(),
    attempts: 0,
    consumedAt: null,
    createdAt: new Date(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates a token with the mapped purpose', async () => {
    model.create.mockResolvedValue(otpRow);
    const record = await repo.create({
      customerId: 'cust-1',
      purpose: OtpPurpose.LOGIN,
      codeHash: 'hashed',
      expiresAt: otpRow.expiresAt,
    });
    expect(record.purpose).toBe(OtpPurpose.LOGIN);
    expect(model.create).toHaveBeenCalled();
  });

  it('finds the active token for a purpose', async () => {
    model.findFirst.mockResolvedValue(otpRow);
    const record = await repo.findActive('cust-1', OtpPurpose.LOGIN);
    expect(record?.id).toBe('otp-1');
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', purpose: 'LOGIN', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('claims an attempt only while one is left', async () => {
    model.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(repo.claimAttempt('otp-1', 5)).resolves.toBe(true);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: 'otp-1', consumedAt: null, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
    model.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repo.claimAttempt('otp-1', 5)).resolves.toBe(false);
  });

  it('consumes and bulk-consumes', async () => {
    await repo.markConsumed('otp-1', new Date());
    await repo.consumeAllForPurpose('cust-1', OtpPurpose.LOGIN, new Date());
    expect(model.update).toHaveBeenCalledTimes(1);
    expect(model.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('RefreshTokenPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  };
  const prisma = { refreshToken: model } as unknown as PrismaService;
  const repo = new RefreshTokenPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('delegates create/find/revoke operations to prisma', async () => {
    model.create.mockResolvedValue({ id: 'rt-1' });
    model.findUnique.mockResolvedValue({ id: 'rt-1' });
    model.findMany.mockResolvedValue([{ id: 'rt-1' }]);

    await repo.create({
      customerId: 'cust-1',
      tokenHash: 'hmac',
      familyId: 'fam-1',
      expiresAt: new Date(),
      userAgent: null,
      ipAddress: null,
    });
    await repo.findByTokenHash('hmac');
    await repo.revoke('rt-1', new Date(), 'rt-2');
    await repo.revokeFamily('fam-1', new Date());
    await repo.revokeAllForCustomer('cust-1', new Date());
    const active = await repo.listActiveForCustomer('cust-1', new Date());

    expect(active).toHaveLength(1);
    expect(model.update).toHaveBeenCalledTimes(1);
    expect(model.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe('AuditLogPrismaRepository', () => {
  it('records an audit entry', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    const repo = new AuditLogPrismaRepository(prisma);

    await repo.record({
      customerId: 'cust-1',
      action: 'auth.login.succeeded',
      success: true,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      metadata: { foo: 'bar' },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'auth.login.succeeded', success: true }),
    });
  });
});

// The lookups and repositories nothing had constructed yet: every by-key miss, the empty-id
// short-circuit, the created-customer count windows, retention pruning, and the whole
// capability-override table (the source of the runtime RBAC patch).
describe('remaining prisma repository paths', () => {
  it('returns null from every by-key customer lookup that misses', async () => {
    const customer = { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn() };
    const repo = new CustomerPrismaRepository({ customer } as unknown as PrismaService);
    expect(await repo.findById('nope')).toBeNull();
    expect(await repo.findByPhone('+628000000000')).toBeNull();
    expect(await repo.findByEmail('nobody@x.com')).toBeNull();
    expect(await repo.findByGoogleSub('sub-x')).toBeNull();
    // An empty id list never touches the database.
    expect(await repo.findByIds([])).toEqual([]);
    expect(customer.findMany).not.toHaveBeenCalled();
  });

  it('maps a batch of ids to entities', async () => {
    const customer = { findMany: jest.fn().mockResolvedValue([customerRow()]) };
    const repo = new CustomerPrismaRepository({ customer } as unknown as PrismaService);
    const out = await repo.findByIds(['cust-1']);
    expect(out[0]?.id).toBe('cust-1');
    expect(customer.findMany).toHaveBeenCalledWith({ where: { id: { in: ['cust-1'] } } });
  });

  // Deleting an account is one transaction with a guard inside it: the platform must never
  // end up with no super admin, and two concurrent deletes of two DIFFERENT super admins
  // must not each see the other as the survivor.
  describe('markDeletedGuardingLastSuperAdmin', () => {
    const repoWith = (target: unknown, live: { id: string }[] = []) => {
      const update = jest.fn().mockResolvedValue({});
      const tx = {
        customer: { findUnique: jest.fn().mockResolvedValue(target), update },
        $queryRaw: jest.fn().mockResolvedValue(live),
      };
      const prisma = {
        $transaction: (fn: (t: unknown) => unknown) => fn(tx),
      } as unknown as PrismaService;
      return { repo: new CustomerPrismaRepository(prisma), tx, update };
    };

    it('reports not-found rather than pretending it deleted something', async () => {
      const { repo, update } = repoWith(null);
      await expect(repo.markDeletedGuardingLastSuperAdmin('gone')).resolves.toBe('not-found');
      expect(update).not.toHaveBeenCalled();
    });

    it('deletes an ordinary customer without touching the super-admin lock', async () => {
      const { repo, tx, update } = repoWith({ role: 'CUSTOMER' });
      await expect(repo.markDeletedGuardingLastSuperAdmin('cust-1')).resolves.toBe('deleted');
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { status: 'DELETED' },
      });
    });

    // The lock covers EVERY active super admin including the target: with `id <> target`
    // in it, two concurrent deletes each lock only the other and both go through.
    it('refuses to delete the last super admin', async () => {
      const { repo, update } = repoWith({ role: 'SUPER_ADMIN' }, [{ id: 'sa-1' }]);
      await expect(repo.markDeletedGuardingLastSuperAdmin('sa-1')).resolves.toBe(
        'last-super-admin',
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('deletes a super admin while another one is still active', async () => {
      const { repo, update } = repoWith({ role: 'SUPER_ADMIN' }, [{ id: 'sa-1' }, { id: 'sa-2' }]);
      await expect(repo.markDeletedGuardingLastSuperAdmin('sa-1')).resolves.toBe('deleted');
      expect(update).toHaveBeenCalled();
    });
  });

  it('counts created customers over an open, one-sided and closed window', async () => {
    const count = jest.fn().mockResolvedValue(7);
    const repo = new CustomerPrismaRepository({ customer: { count } } as unknown as PrismaService);
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    expect(await repo.countCustomersCreated()).toBe(7);
    expect(count.mock.calls[0][0].where.createdAt).toBeUndefined();
    await repo.countCustomersCreated(from);
    expect(count.mock.calls[1][0].where.createdAt).toEqual({ gte: from });
    await repo.countCustomersCreated(undefined, to);
    expect(count.mock.calls[2][0].where.createdAt).toEqual({ lt: to });
    await repo.countCustomersCreated(from, to);
    expect(count.mock.calls[3][0].where.createdAt).toEqual({ gte: from, lt: to });
  });

  it('prunes audit rows older than the cutoff and writes an entry with no metadata', async () => {
    const auditLog = {
      deleteMany: jest.fn().mockResolvedValue({ count: 12 }),
      create: jest.fn().mockResolvedValue({}),
    };
    const repo = new AuditLogPrismaRepository({ auditLog } as unknown as PrismaService);
    const cutoff = new Date('2026-01-01');
    expect(await repo.deleteOlderThan(cutoff)).toBe(12);
    expect(auditLog.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: cutoff } } });
    await repo.record({
      customerId: null,
      action: 'auth.login.failed',
      success: false,
      ipAddress: null,
      userAgent: null,
    } as never);
    expect(auditLog.create.mock.calls[0][0].data.metadata).toBeUndefined();
  });

  it('reads, writes and clears a capability override', async () => {
    const capabilityOverride = {
      findMany: jest.fn().mockResolvedValue([
        {
          capability: 'staffAdmin',
          roles: ['SUPER_ADMIN'],
          updatedBy: 'admin-1',
          updatedAt: new Date('2026-01-01'),
        },
      ]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const repo = new CapabilityOverridePrismaRepository({
      capabilityOverride,
    } as unknown as PrismaService);

    expect(await repo.listAll()).toEqual([
      {
        capability: 'staffAdmin',
        roles: ['SUPER_ADMIN'],
        updatedBy: 'admin-1',
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    expect(capabilityOverride.findMany).toHaveBeenCalledWith({ orderBy: { capability: 'asc' } });

    await repo.upsert('staffAdmin', ['SUPER_ADMIN'] as never, 'admin-1');
    expect(capabilityOverride.upsert).toHaveBeenCalledWith({
      where: { capability: 'staffAdmin' },
      create: { capability: 'staffAdmin', roles: ['SUPER_ADMIN'], updatedBy: 'admin-1' },
      update: { roles: ['SUPER_ADMIN'], updatedBy: 'admin-1' },
    });

    // Resetting a capability that was never overridden is a no-op, not a 404.
    await repo.remove('never-set');
    expect(capabilityOverride.deleteMany).toHaveBeenCalledWith({
      where: { capability: 'never-set' },
    });
  });

  it('applies a batch of matrix edits inside one transaction', async () => {
    const capabilityOverride = {
      upsert: jest.fn().mockReturnValue('upsert-op'),
      deleteMany: jest.fn().mockReturnValue('delete-op'),
    };
    const $transaction = jest.fn().mockResolvedValue([]);
    const repo = new CapabilityOverridePrismaRepository({
      capabilityOverride,
      $transaction,
    } as unknown as PrismaService);

    await repo.applyAll(
      [
        { capability: 'staffAdmin', roles: ['SUPER_ADMIN'] as never },
        { capability: 'approvals', roles: null },
      ],
      'admin-1',
    );

    // ONE transaction, both operations inside it: a rejection cannot leave the first
    // capability written and the second not.
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][0]).toEqual(['upsert-op', 'delete-op']);
    expect(capabilityOverride.upsert).toHaveBeenCalledWith({
      where: { capability: 'staffAdmin' },
      create: { capability: 'staffAdmin', roles: ['SUPER_ADMIN'], updatedBy: 'admin-1' },
      update: { roles: ['SUPER_ADMIN'], updatedBy: 'admin-1' },
    });
    expect(capabilityOverride.deleteMany).toHaveBeenCalledWith({
      where: { capability: 'approvals' },
    });
  });

  it('does not open a transaction for an empty batch', async () => {
    const $transaction = jest.fn();
    const repo = new CapabilityOverridePrismaRepository({
      capabilityOverride: {},
      $transaction,
    } as unknown as PrismaService);

    await repo.applyAll([], null);
    expect($transaction).not.toHaveBeenCalled();
  });
});
