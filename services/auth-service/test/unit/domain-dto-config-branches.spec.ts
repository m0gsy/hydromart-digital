import {
  ArgumentsHost,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MulterError } from 'multer';

import { Customer, CustomerProps } from '../../src/domain/customer/customer.entity';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import {
  AccountNotActiveError,
  CustomerNotFoundError,
  InvalidGoogleTokenError,
  InvalidRefreshTokenError,
  OtpInvalidError,
  OtpResendCooldownError,
} from '../../src/domain/errors/auth.errors';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { getRequestContext } from '../../src/common/http/request-context';
import { HealthController } from '../../src/modules/health/health.controller';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { MulterExceptionFilter } from '../../src/modules/auth/multer-exception.filter';
import { AuditLogDto, AuditQueryDto, DepotAuditQueryDto, IngestAuditDto } from '../../src/modules/auth/dto/audit.dto';
import { InviteStaffDto, ListStaffQueryDto } from '../../src/modules/auth/dto/staff.dto';
import { SessionInfoDto } from '../../src/modules/auth/dto/responses.dto';
import { buildTestConfig } from '../support/fakes';

const baseProps = (overrides: Partial<CustomerProps> = {}): CustomerProps => ({
  id: 'cust-1', phone: '+6281234567890', email: null, fullName: null, role: Role.CUSTOMER,
  status: CustomerStatus.ACTIVE, googleSub: null, avatarUrl: null, assignedDepotId: null,
  vehicleType: null, plateNumber: null, phoneVerifiedAt: null, lastLoginAt: null,
  createdAt: new Date('2026-01-01Z'), updatedAt: new Date('2026-01-01Z'), ...overrides,
});

describe('Customer entity branch gaps', () => {
  it('fills a missing email from Google but keeps an existing name', () => {
    const customer = Customer.fromPersistence(baseProps({ email: null, fullName: 'Existing Name' }));
    customer.linkGoogle('sub-1', 'from-google@x.com', 'Google Name');
    expect(customer.email).toBe('from-google@x.com'); // was null → filled
    expect(customer.fullName).toBe('Existing Name'); // already set → untouched
  });

  it('sets the avatar url', () => {
    const customer = Customer.fromPersistence(baseProps());
    customer.setAvatar('https://cdn/a.png');
    expect(customer.avatarUrl).toBe('https://cdn/a.png');
  });

  it('sets vehicle info and leaves undefined fields untouched', () => {
    const customer = Customer.fromPersistence(baseProps({ vehicleType: 'OLD', plateNumber: 'OLD-1' }));
    customer.setVehicle('MOTOR', 'B 1 ABC');
    expect(customer.vehicleType).toBe('MOTOR');
    expect(customer.plateNumber).toBe('B 1 ABC');

    customer.setVehicle(undefined, undefined); // both skipped
    expect(customer.vehicleType).toBe('MOTOR');
    expect(customer.plateNumber).toBe('B 1 ABC');
  });
});

describe('auth domain errors default vs custom messages', () => {
  it('uses default messages', () => {
    expect(new CustomerNotFoundError().status).toBe(404);
    expect(new AccountNotActiveError().status).toBe(403);
    expect(new OtpInvalidError().status).toBe(401);
    expect(new InvalidRefreshTokenError().status).toBe(401);
    expect(new InvalidGoogleTokenError().status).toBe(401);
  });

  it('accepts custom messages and computes cooldown copy', () => {
    expect(new CustomerNotFoundError('nope').message).toBe('nope');
    expect(new AccountNotActiveError('suspended').message).toBe('suspended');
    expect(new OtpInvalidError('bad').message).toBe('bad');
    expect(new InvalidRefreshTokenError('gone').message).toBe('gone');
    expect(new InvalidGoogleTokenError('fail').message).toBe('fail');
    expect(new OtpResendCooldownError(30).message).toContain('30s');
  });
});

describe('AuthConfigService getters', () => {
  it('exposes storage + internal-key config with defaults', () => {
    const config = buildTestConfig();
    expect(config.internalServiceKey).toBe('');
    expect(config.storageLocalDir).toBe('./var/uploads');
    expect(config.storagePublicBaseUrl).toBe('http://localhost:3001');
    expect(config.storageDriver).toBe('local');
  });

  it('strips a trailing slash from the public base url and reads s3 config', () => {
    const config = buildTestConfig({
      STORAGE_PUBLIC_BASE_URL: 'https://cdn.example//',
      STORAGE_DRIVER: 's3',
      STORAGE_S3_ENDPOINT: 'https://nos.example',
      STORAGE_S3_BUCKET: 'bucket',
      STORAGE_S3_ACCESS_KEY_ID: 'ak',
      STORAGE_S3_SECRET_ACCESS_KEY: 'sk',
    });
    expect(config.storagePublicBaseUrl).toBe('https://cdn.example');
    expect(config.storageDriver).toBe('s3');
    expect(config.s3).toMatchObject({ endpoint: 'https://nos.example', region: 'auto', bucket: 'bucket' });
  });
});

describe('getRequestContext', () => {
  const make = (partial: Partial<Request>): Request => partial as Request;

  it('takes the first ip from an array x-forwarded-for', () => {
    const ctx = getRequestContext(make({ headers: { 'x-forwarded-for': ['1.1.1.1', '2.2.2.2'], 'user-agent': 'jest' }, socket: {} as never }));
    expect(ctx.ipAddress).toBe('1.1.1.1');
    expect(ctx.userAgent).toBe('jest');
  });

  it('takes the first ip from a comma-joined x-forwarded-for', () => {
    const ctx = getRequestContext(make({ headers: { 'x-forwarded-for': '3.3.3.3, 4.4.4.4' }, socket: {} as never }));
    expect(ctx.ipAddress).toBe('3.3.3.3');
    expect(ctx.userAgent).toBeNull();
  });

  it('falls back to request.ip then socket.remoteAddress', () => {
    expect(getRequestContext(make({ headers: {}, ip: '5.5.5.5', socket: {} as never })).ipAddress).toBe('5.5.5.5');
    expect(getRequestContext(make({ headers: {}, socket: { remoteAddress: '6.6.6.6' } as never })).ipAddress).toBe('6.6.6.6');
    expect(getRequestContext(make({ headers: {}, socket: {} as never })).ipAddress).toBeNull();
  });
});

describe('query DTOs coerce numeric params', () => {
  it('transforms ListStaffQueryDto page/limit to numbers', () => {
    const dto = plainToInstance(ListStaffQueryDto, { page: '2', limit: '10', role: Role.STAFF_DEPOT });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
  });

  it('transforms audit query DTOs', () => {
    expect(plainToInstance(AuditQueryDto, { page: '3', limit: '5' }).page).toBe(3);
    expect(plainToInstance(DepotAuditQueryDto, { depotId: 'd', page: '4', limit: '9' }).limit).toBe(9);
    expect(plainToInstance(IngestAuditDto, { action: 'x', success: true }).action).toBe('x');
  });
});

/*
 * The salary pair used to be enforced only in hr-service, one HTTP hop away, so a console
 * invite that forgot the rate came back as `503 — hr-service menolak permintaan (400)` with
 * the account already minted. These four cases are the whole rule.
 */
describe('InviteStaffDto salary pairing', () => {
  const base = {
    phone: '+628123456789',
    role: Role.STAFF_DEPOT,
    position: 'Kurir',
    joinDate: '2026-08-17',
    employmentStatus: 'PERMANENT',
  };
  const errorsFor = (extra: Record<string, unknown>) =>
    validateSync(plainToInstance(InviteStaffDto, { ...base, ...extra }))
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join(' ');

  it('refuses MONTHLY with no monthlyRate, naming the field', () => {
    expect(errorsFor({ salaryType: 'MONTHLY' })).toContain('monthlyRate wajib diisi');
  });

  it('refuses DAILY with no dailyRate, naming the field', () => {
    expect(errorsFor({ salaryType: 'DAILY' })).toContain('dailyRate wajib diisi');
  });

  it('accepts each type with its own rate, and does not demand the other one', () => {
    expect(errorsFor({ salaryType: 'MONTHLY', monthlyRate: 4_500_000 })).toBe('');
    expect(errorsFor({ salaryType: 'DAILY', dailyRate: 150_000 })).toBe('');
  });

  /* FRANCHISE_OWNER skips the employee record entirely and the console sends 0 for it. */
  it('accepts a zero rate, and still type-checks a supplied off-type rate', () => {
    expect(errorsFor({ salaryType: 'MONTHLY', monthlyRate: 0 })).toBe('');
    expect(errorsFor({ salaryType: 'MONTHLY', monthlyRate: 1, dailyRate: -1 })).toContain(
      'dailyRate',
    );
  });
});

describe('AuditLogDto.from', () => {
  const item = (metadata: Record<string, unknown> | null) => ({
    id: 'a1', customerId: 'c1', action: 'depot.suspend', success: true, ipAddress: null, userAgent: null,
    metadata, createdAt: new Date('2026-01-01T00:00:00Z'), actorEmail: null, actorName: null, actorRole: null,
  });

  it('lifts a string target out of metadata', () => {
    expect(AuditLogDto.from(item({ target: 'Depot A' })).target).toBe('Depot A');
  });

  it('leaves target null when metadata has none', () => {
    expect(AuditLogDto.from(item(null)).target).toBeNull();
    expect(AuditLogDto.from(item({ other: 1 })).target).toBeNull();
  });
});

describe('SessionInfoDto.from', () => {
  it('copies the session fields', () => {
    const now = new Date();
    const dto = SessionInfoDto.from({ id: 's1', createdAt: now, expiresAt: now, ipAddress: '1.1.1.1', userAgent: 'jest' });
    expect(dto).toMatchObject({ id: 's1', ipAddress: '1.1.1.1', userAgent: 'jest' });
  });
});

describe('AllExceptionsFilter http error codes', () => {
  function run(exception: HttpException): { status?: number; body?: { code?: string } } {
    const captured: { status?: number; body?: { code?: string } } = {};
    const response = {
      status(code: number) { captured.status = code; return this; },
      json(payload: { code?: string }) { captured.body = payload; return this; },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ url: '/x', method: 'GET' }) }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    return captured;
  }

  it('maps FORBIDDEN to FORBIDDEN', () => {
    expect(run(new ForbiddenException()).body?.code).toBe('FORBIDDEN');
  });
  it('maps NOT_FOUND to NOT_FOUND', () => {
    expect(run(new NotFoundException()).body?.code).toBe('NOT_FOUND');
  });
  it('maps TOO_MANY_REQUESTS to RATE_LIMITED', () => {
    const tooMany = new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS);
    expect(run(tooMany).body?.code).toBe('RATE_LIMITED');
  });
  it('maps a string-response http exception with a default code', () => {
    const teapot = new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT);
    const out = run(teapot);
    expect(out.status).toBe(HttpStatus.I_AM_A_TEAPOT);
    expect(out.body?.code).toBe('HTTP_ERROR');
  });
});

describe('HealthController', () => {
  it('reports ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as PrismaService;
    const result = await new HealthController(prisma).check();
    expect(result.status).toBe('ok');
    expect(result.checks.database).toBe('up');
  });

  it('throws 503 when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('no db')) } as unknown as PrismaService;
    await expect(new HealthController(prisma).check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('MulterExceptionFilter', () => {
  function run(error: MulterError): { status?: number; body?: { statusCode?: number; error?: string } } {
    const captured: { status?: number; body?: { statusCode?: number; error?: string } } = {};
    const response = {
      status(code: number) { captured.status = code; return this; },
      json(payload: { statusCode?: number; error?: string }) { captured.body = payload; return this; },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    new MulterExceptionFilter().catch(error, host);
    return captured;
  }

  it('maps a file-size overflow to 413', () => {
    const out = run(new MulterError('LIMIT_FILE_SIZE'));
    expect(out.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(out.body?.error).toBe('Payload Too Large');
  });

  it('maps any other multer error to 400', () => {
    const out = run(new MulterError('LIMIT_UNEXPECTED_FILE'));
    expect(out.status).toBe(HttpStatus.BAD_REQUEST);
    expect(out.body?.error).toBe('Bad Request');
  });
});
