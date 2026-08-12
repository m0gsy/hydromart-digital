import * as fsPromises from 'node:fs/promises';

import { S3Client } from '@aws-sdk/client-s3';

// Keep the real module (the AWS SDK reads shared config through it) and override
// only the two write calls the local-disk adapter makes.
jest.mock('node:fs/promises', () => ({
  ...jest.requireActual('node:fs/promises'),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
}));
import { Prisma } from '@prisma/client';

import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Customer } from '../../src/domain/customer/customer.entity';
import {
  EmailAlreadyRegisteredError,
  PhoneAlreadyRegisteredError,
} from '../../src/domain/errors/auth.errors';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { S3StorageAdapter } from '../../src/infrastructure/storage/s3-storage.adapter';
import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';
import { CustomerNotificationHttpAdapter } from '../../src/infrastructure/notification/customer-notification.http.adapter';
import { SmsOtpDeliveryAdapter } from '../../src/infrastructure/otp-delivery/sms-otp-delivery.adapter';
import { ZenzivaOtpDeliveryAdapter } from '../../src/infrastructure/otp-delivery/zenziva-otp-delivery.adapter';
import { CustomerPrismaRepository } from '../../src/infrastructure/prisma/repositories/customer.prisma.repository';
import { OtpTokenPrismaRepository } from '../../src/infrastructure/prisma/repositories/otp-token.prisma.repository';
import { RefreshTokenPrismaRepository } from '../../src/infrastructure/prisma/repositories/refresh-token.prisma.repository';
import { AuditLogPrismaRepository } from '../../src/infrastructure/prisma/repositories/audit-log.prisma.repository';
import { OAuth2Client } from 'google-auth-library';

import { GoogleVerifier } from '../../src/infrastructure/security/google-verifier';
import { AuditService } from '../../src/application/services/audit.service';
import { OtpService } from '../../src/application/services/otp.service';
import { DataSubjectRequestDto } from '../../src/modules/auth/dto/data-subject.dto';
import { buildTestConfig, InMemoryAuditLogRepository } from '../support/fakes';

const message = {
  phone: '+6281234567890',
  code: '123456',
  purpose: OtpPurpose.REGISTRATION,
  ttlSeconds: 300,
};

describe('PrismaService lifecycle', () => {
  it('connects on init and disconnects on destroy', async () => {
    const svc = new PrismaService();
    const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined as never);
    const disconnect = jest.spyOn(svc, '$disconnect').mockResolvedValue(undefined as never);

    await svc.onModuleInit();
    await svc.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('S3StorageAdapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uploads to the bucket and returns the public url', async () => {
    const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const config = buildTestConfig({
      STORAGE_S3_ENDPOINT: 'https://nos.example',
      STORAGE_S3_BUCKET: 'avatars-bucket',
      STORAGE_S3_ACCESS_KEY_ID: 'ak',
      STORAGE_S3_SECRET_ACCESS_KEY: 'sk',
      STORAGE_PUBLIC_BASE_URL: 'https://cdn.example/',
    });
    const adapter = new S3StorageAdapter(config);

    const result = await adapter.put({
      body: Buffer.from('img'),
      contentType: 'image/png',
      ext: 'png',
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.key).toMatch(/^avatars\/.+\.png$/);
    expect(result.url).toBe(`https://cdn.example/${result.key}`);
  });
});

describe('LocalDiskStorageAdapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('writes the file to disk and returns the served url', async () => {
    const mkdir = fsPromises.mkdir as jest.Mock;
    const writeFile = fsPromises.writeFile as jest.Mock;
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    const config = buildTestConfig({
      STORAGE_LOCAL_DIR: './var/uploads',
      STORAGE_PUBLIC_BASE_URL: 'http://localhost:3001',
    });
    const adapter = new LocalDiskStorageAdapter(config);

    const result = await adapter.put({
      body: Buffer.from('img'),
      contentType: 'image/png',
      ext: 'jpg',
    });

    expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(writeFile).toHaveBeenCalled();
    expect(result.key).toMatch(/^avatars\/.+\.jpg$/);
    expect(result.url).toBe(`http://localhost:3001/uploads/${result.key}`);
  });
});

describe('CustomerNotificationHttpAdapter', () => {
  const enabledConfig = buildTestConfig({
    CRM_SERVICE_URL: 'https://crm.example',
    INTERNAL_SERVICE_KEY: 'internal-key',
  });

  afterEach(() => jest.restoreAllMocks());

  it('no-ops when CRM notifications are not configured', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const adapter = new CustomerNotificationHttpAdapter(buildTestConfig());
    await expect(adapter.sendWelcome('+6281234567890', 'Budi')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the welcome event when configured', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const adapter = new CustomerNotificationHttpAdapter(enabledConfig);

    await adapter.sendWelcome('+6281234567890', 'Budi');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://crm.example/api/v1/notifications/internal');
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe('internal-key');
  });

  it('swallows a non-ok response (fail-open)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    const adapter = new CustomerNotificationHttpAdapter(enabledConfig);
    await expect(adapter.sendWelcome('+6281234567890', 'Budi')).resolves.toBeUndefined();
  });

  it('swallows a transport error (fail-open)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const adapter = new CustomerNotificationHttpAdapter(enabledConfig);
    await expect(adapter.sendWelcome('+6281234567890', 'Budi')).resolves.toBeUndefined();
  });

  it('aborts and swallows on timeout', async () => {
    jest.useFakeTimers();
    let rejectFetch: (e: unknown) => void = () => undefined;
    const pending = new Promise<Response>((_, rej) => {
      rejectFetch = rej;
    });
    jest.spyOn(global, 'fetch').mockReturnValue(pending);
    const adapter = new CustomerNotificationHttpAdapter(enabledConfig);

    const promise = adapter.sendWelcome('+6281234567890', 'Budi');
    jest.advanceTimersByTime(5000); // fires the abort() timeout callback
    rejectFetch(new Error('The operation was aborted'));

    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});

describe('SmsOtpDeliveryAdapter text-fallback', () => {
  afterEach(() => jest.restoreAllMocks());

  it('still throws when reading the error body itself fails', async () => {
    const config = buildTestConfig({ SMS_API_BASE_URL: 'https://sms.example', SMS_API_TOKEN: 't' });
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error('stream error');
      },
    } as unknown as Response);
    await expect(new SmsOtpDeliveryAdapter(config).send(message)).rejects.toThrow(/SMS/);
  });
});

describe('ZenzivaOtpDeliveryAdapter branch gaps', () => {
  const config = buildTestConfig({ ZENZIVA_USERKEY: 'u', ZENZIVA_PASSKEY: 'p' });

  afterEach(() => jest.restoreAllMocks());

  it('passes a non-Indonesian number through untouched', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: '1' }),
    } as Response);
    await new ZenzivaOtpDeliveryAdapter(config).send({ ...message, phone: '+15551234567' });
    const form = new URLSearchParams((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(form.get('to')).toBe('+15551234567');
  });

  it('throws when the error body cannot be read on a transport failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => {
        throw new Error('stream error');
      },
    } as unknown as Response);
    await expect(new ZenzivaOtpDeliveryAdapter(config).send(message)).rejects.toThrow(/502/);
  });

  it('throws when the success body cannot be parsed as json', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(new ZenzivaOtpDeliveryAdapter(config).send(message)).rejects.toThrow(/Zenziva/);
  });

  it('aborts the request when it exceeds the timeout', async () => {
    jest.useFakeTimers();
    let rejectFetch: (e: unknown) => void = () => undefined;
    const pending = new Promise<Response>((_, rej) => {
      rejectFetch = rej;
    });
    jest.spyOn(global, 'fetch').mockReturnValue(pending);

    const promise = new ZenzivaOtpDeliveryAdapter(config).send(message).catch((e) => e as Error);
    jest.advanceTimersByTime(15000); // fires the abort() timeout callback
    rejectFetch(new Error('The operation was aborted'));

    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    jest.useRealTimers();
  });
});

describe('CustomerPrismaRepository branch gaps', () => {
  const model = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const prisma = { customer: model } as unknown as PrismaService;
  const repo = new CustomerPrismaRepository(prisma);
  const row = () => ({
    id: 'cust-1',
    phone: '+6281234567890',
    email: 'b@x.com',
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

  beforeEach(() => jest.clearAllMocks());

  it('filters the staff list by role and depot', async () => {
    model.findMany.mockResolvedValue([row()]);
    model.count.mockResolvedValue(1);
    const result = await repo.listStaff(2, 10, Role.STAFF_DEPOT, 'depot-1');
    expect(result.total).toBe(1);
    const where = model.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ role: 'STAFF_DEPOT', assignedDepotId: 'depot-1' });
    expect(model.findMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 10 });
  });

  // Audit F-12: without this predicate the HQ search matched only the page the browser
  // already held, so anyone past the first 100 rows was unfindable.
  it('matches the staff search term against name or phone in the query, not in memory', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    await repo.listStaff(1, 10, undefined, undefined, '  Budi ');
    const where = model.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { fullName: { contains: 'Budi', mode: 'insensitive' } },
      { phone: { contains: 'Budi' } },
    ]);
  });

  it('omits the search predicate entirely when no term is given', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    await repo.listStaff(1, 10, undefined, undefined, '   ');
    expect(model.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it('defaults the staff list to all non-customer roles', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    await repo.listStaff(1, 20);
    const where = model.findMany.mock.calls[0][0].where;
    expect(where.role).toEqual({ not: 'CUSTOMER' });
    expect(where.assignedDepotId).toBeUndefined();
  });

  it('counts customers within a date window', async () => {
    model.count.mockResolvedValue(5);
    await repo.countCustomersCreated(new Date('2026-01-01'), new Date('2026-02-01'));
    expect(model.count.mock.calls[0][0].where.createdAt).toMatchObject({
      gte: expect.any(Date),
      lt: expect.any(Date),
    });
  });

  it('counts all customers when no window is given', async () => {
    model.count.mockResolvedValue(9);
    await repo.countCustomersCreated();
    expect(model.count.mock.calls[0][0].where.createdAt).toBeUndefined();
  });

  it('translates a P2002 email conflict into a domain error', async () => {
    model.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'] },
      }),
    );
    const customer = Customer.fromPersistence({
      ...row(),
      role: Role.CUSTOMER,
      status: CustomerStatus.ACTIVE,
    });
    await expect(repo.save(customer)).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  // The race the service pre-check cannot win: two edits a millisecond apart both read the
  // number as free and the index decides. It must read as "taken", not as a database error.
  it('translates a P2002 phone conflict into a domain error', async () => {
    model.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['phone'] },
      }),
    );
    const customer = Customer.fromPersistence({
      ...row(),
      role: Role.CUSTOMER,
      status: CustomerStatus.ACTIVE,
    });
    await expect(repo.save(customer)).rejects.toBeInstanceOf(PhoneAlreadyRegisteredError);
  });

  // A P2002 on any OTHER column is not one of the two the service knows how to explain.
  it('rethrows a P2002 on a column it has no sentence for', async () => {
    model.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['googleSub'] },
      }),
    );
    const customer = Customer.fromPersistence({
      ...row(),
      role: Role.CUSTOMER,
      status: CustomerStatus.ACTIVE,
    });
    await expect(repo.save(customer)).rejects.toThrow('dup');
  });

  it('rethrows a non-P2002 database error', async () => {
    model.update.mockRejectedValue(new Error('db down'));
    const customer = Customer.fromPersistence({
      ...row(),
      role: Role.CUSTOMER,
      status: CustomerStatus.ACTIVE,
    });
    await expect(repo.save(customer)).rejects.toThrow('db down');
  });
});

describe('AuditLogPrismaRepository.list branch gaps', () => {
  const auditLog = { findMany: jest.fn(), count: jest.fn(), create: jest.fn() };
  const customer = { findMany: jest.fn() };
  const prisma = { auditLog, customer } as unknown as PrismaService;
  const repo = new AuditLogPrismaRepository(prisma);
  const auditRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'a1',
    customerId: 'cust-1',
    action: 'staff.login',
    success: true,
    ipAddress: null,
    userAgent: null,
    metadata: { depotId: 'depot-1' },
    createdAt: new Date('2026-01-01'),
    ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it('applies every filter and resolves the actor identity', async () => {
    auditLog.findMany.mockResolvedValue([auditRow()]);
    auditLog.count.mockResolvedValue(1);
    customer.findMany.mockResolvedValue([
      { id: 'cust-1', email: 'a@x.com', fullName: 'Admin', role: 'SUPER_ADMIN' },
    ]);

    const result = await repo.list({
      page: 1,
      limit: 20,
      action: 'staff.login',
      customerId: 'cust-1',
      depotId: 'depot-1',
      type: 'STAF',
    });

    expect(result.total).toBe(1);
    expect(result.items[0].actorEmail).toBe('a@x.com');
    const where = auditLog.findMany.mock.calls[0][0].where;
    expect(where.action).toBe('staff.login');
    expect(where.customerId).toBe('cust-1');
    expect(where.metadata).toEqual({ path: ['depotId'], equals: 'depot-1' });
    expect(where.OR).toEqual(
      expect.arrayContaining([{ action: { contains: 'staff', mode: 'insensitive' } }]),
    );
  });

  it('skips the actor lookup for system rows with no actor', async () => {
    auditLog.findMany.mockResolvedValue([auditRow({ customerId: null, metadata: null })]);
    auditLog.count.mockResolvedValue(1);

    const result = await repo.list({ page: 1, limit: 20 });

    expect(customer.findMany).not.toHaveBeenCalled();
    expect(result.items[0].actorEmail).toBeNull();
    expect(result.items[0].metadata).toBeNull();
    expect(auditLog.findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe('OtpTokenPrismaRepository.findActive null', () => {
  it('returns null when no active token exists', async () => {
    const otpToken = { findFirst: jest.fn().mockResolvedValue(null) };
    const repo = new OtpTokenPrismaRepository({ otpToken } as unknown as PrismaService);
    expect(await repo.findActive('cust-1', OtpPurpose.LOGIN)).toBeNull();
  });
});

describe('RefreshTokenPrismaRepository.revoke without replacement', () => {
  it('nulls replacedById when no replacement is given', async () => {
    const refreshToken = { update: jest.fn().mockResolvedValue({}) };
    const repo = new RefreshTokenPrismaRepository({ refreshToken } as unknown as PrismaService);
    await repo.revoke('rt-1', new Date());
    expect(refreshToken.update.mock.calls[0][0].data.replacedById).toBeNull();
  });
});

// The last few defensive fallbacks: a Google payload that carries only `sub`, an audit ingest
// with a target but no metadata of its own, a phone too short to mask, a PDP request that has
// already been processed, and the PDP fan-out config getter.
describe('remaining fallback branches', () => {
  it('defaults every optional Google claim when the payload carries only a sub', async () => {
    jest
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockResolvedValue({ getPayload: () => ({ sub: 'google-sub-1' }) } as never);
    const verifier = new GoogleVerifier(buildTestConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-1' }));
    await expect(verifier.verify('token')).resolves.toEqual({
      sub: 'google-sub-1',
      email: null,
      emailVerified: false,
      name: null,
    });
  });

  it('attaches a target to an ingest that carried no metadata', async () => {
    const auditLog = new InMemoryAuditLogRepository();
    await new AuditService(auditLog).ingest({
      actorId: 'admin-1',
      action: 'depot.suspend',
      success: true,
      target: 'Depot A',
    } as never);
    expect(auditLog.entries.at(-1)?.metadata).toEqual({ target: 'Depot A' });
  });

  it('leaves a phone too short to mask alone', () => {
    expect(OtpService.maskPhone('+62812')).toBe('+62812');
  });

  it('serialises a processed PDP request with its timestamp', () => {
    const processedAt = new Date('2026-02-01T00:00:00.000Z');
    const dto = DataSubjectRequestDto.from({
      id: 'r1',
      customerId: 'cust-1',
      type: 'EXPORT',
      status: 'DONE',
      reason: null,
      requestedAt: new Date('2026-01-01T00:00:00.000Z'),
      processedBy: 'admin-1',
      processedAt,
    } as never);
    expect(dto.processedAt).toBe(processedAt.toISOString());
  });

  it('reads the PDP fan-out target from configuration', () => {
    expect(
      buildTestConfig({
        CUSTOMER_SERVICE_URL: 'http://customer:3002',
        INTERNAL_SERVICE_KEY: 'k',
      }).customerData,
    ).toEqual({ customerUrl: 'http://customer:3002', internalKey: 'k' });
  });
});
