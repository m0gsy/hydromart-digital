import { Role } from '../../src/domain/customer/role.enum';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CustomerPrismaRepository } from '../../src/infrastructure/prisma/repositories/customer.prisma.repository';
import { OtpTokenPrismaRepository } from '../../src/infrastructure/prisma/repositories/otp-token.prisma.repository';
import { RefreshTokenPrismaRepository } from '../../src/infrastructure/prisma/repositories/refresh-token.prisma.repository';
import { AuditLogPrismaRepository } from '../../src/infrastructure/prisma/repositories/audit-log.prisma.repository';
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
    await repo.create({ phone: '+6281234567890', email: null, fullName: null, role: Role.CUSTOMER });
    expect(model.create).toHaveBeenCalledWith({
      data: { phone: '+6281234567890', email: null, fullName: null, role: 'CUSTOMER', assignedDepotId: null, vehicleType: null, plateNumber: null },
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
      expect.objectContaining({ where: { id: 'cust-1' }, data: expect.objectContaining({ status: 'ACTIVE' }) }),
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

  it('increments, consumes and bulk-consumes', async () => {
    await repo.incrementAttempts('otp-1');
    await repo.markConsumed('otp-1', new Date());
    await repo.consumeAllForPurpose('cust-1', OtpPurpose.LOGIN, new Date());
    expect(model.update).toHaveBeenCalledTimes(2);
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
