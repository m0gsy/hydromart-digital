import { ConfigService } from '@nestjs/config';

import { Customer } from '../../src/domain/customer/customer.entity';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { AuthConfigService } from '../../src/config/auth-config.service';
import {
  AccessTokenClaims,
  AccessTokenSignerPort,
  SignedAccessToken,
} from '../../src/application/ports/access-token-signer.port';
import { ClockPort } from '../../src/application/ports/clock.port';
import { CryptoPort } from '../../src/application/ports/crypto.port';
import {
  CreateCustomerData,
  CustomerRepository,
} from '../../src/application/ports/customer.repository';
import { GoogleIdentity, GoogleVerifierPort } from '../../src/application/ports/google-verifier.port';
import { OtpDeliveryPort, OtpMessage } from '../../src/application/ports/otp-delivery.port';
import {
  CreateOtpTokenData,
  OtpTokenRecord,
  OtpTokenRepository,
} from '../../src/application/ports/otp-token.repository';
import {
  CreateRefreshTokenData,
  RefreshTokenRecord,
  RefreshTokenRepository,
} from '../../src/application/ports/refresh-token.repository';
import {
  AuditLogEntry,
  AuditLogListItem,
  AuditLogQuery,
  AuditLogRepository,
} from '../../src/application/ports/audit-log.repository';

let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${(idCounter += 1)}`;

/** Deterministic clock for time-dependent assertions. */
export class FakeClock implements ClockPort {
  constructor(private current: Date = new Date('2026-01-01T00:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
  set(date: Date): void {
    this.current = date;
  }
}

/** Deterministic crypto: reversible "hashes" so tests can assert without bcrypt cost. */
export class FakeCrypto implements CryptoPort {
  public fixedCode = '123456';
  private tokenSeq = 0;

  generateNumericCode(length: number): string {
    return this.fixedCode.slice(0, length).padEnd(length, '0');
  }
  generateOpaqueToken(): string {
    this.tokenSeq += 1;
    return `opaque-${this.tokenSeq}`;
  }
  async hashSecret(value: string): Promise<string> {
    return `hashed:${value}`;
  }
  async verifySecret(value: string, hash: string): Promise<boolean> {
    return hash === `hashed:${value}`;
  }
  hashToken(value: string): string {
    return `hmac:${value}`;
  }
  uuid(): string {
    return nextId('uuid');
  }
}

export class FakeOtpDelivery implements OtpDeliveryPort {
  public readonly sent: OtpMessage[] = [];
  public shouldFail = false;
  async send(message: OtpMessage): Promise<void> {
    if (this.shouldFail) {
      throw new Error('delivery failed');
    }
    this.sent.push(message);
  }
  get lastCode(): string | undefined {
    return this.sent.at(-1)?.code;
  }
}

export class FakeAccessTokenSigner implements AccessTokenSignerPort {
  async sign(claims: AccessTokenClaims): Promise<SignedAccessToken> {
    return { token: `access:${claims.sub}`, expiresIn: 900 };
  }
}

export class FakeGoogleVerifier implements GoogleVerifierPort {
  public identity: GoogleIdentity | null = null;
  public error: Error | null = null;
  async verify(_idToken: string): Promise<GoogleIdentity> {
    if (this.error) {
      throw this.error;
    }
    if (!this.identity) {
      throw new Error('no identity configured');
    }
    return this.identity;
  }
}

export class InMemoryCustomerRepository implements CustomerRepository {
  public readonly rows = new Map<string, ReturnType<Customer['toProps']>>();

  seed(customer: Customer): void {
    this.rows.set(customer.id, customer.toProps());
  }

  async findById(id: string): Promise<Customer | null> {
    const props = this.rows.get(id);
    return props ? Customer.fromPersistence({ ...props }) : null;
  }
  async findByPhone(phone: string): Promise<Customer | null> {
    for (const props of this.rows.values()) {
      if (props.phone === phone) {
        return Customer.fromPersistence({ ...props });
      }
    }
    return null;
  }
  async findByEmail(email: string): Promise<Customer | null> {
    for (const props of this.rows.values()) {
      if (props.email === email) {
        return Customer.fromPersistence({ ...props });
      }
    }
    return null;
  }
  async findByGoogleSub(googleSub: string): Promise<Customer | null> {
    for (const props of this.rows.values()) {
      if (props.googleSub === googleSub) {
        return Customer.fromPersistence({ ...props });
      }
    }
    return null;
  }
  async create(data: CreateCustomerData): Promise<Customer> {
    const now = new Date();
    const customer = Customer.fromPersistence({
      id: nextId('cust'),
      phone: data.phone,
      email: data.email,
      fullName: data.fullName,
      role: data.role,
      status: CustomerStatus.PENDING_VERIFICATION,
      googleSub: null,
      avatarUrl: null,
      assignedDepotId: data.assignedDepotId ?? null,
      phoneVerifiedAt: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    this.rows.set(customer.id, customer.toProps());
    return customer;
  }
  async save(customer: Customer): Promise<Customer> {
    this.rows.set(customer.id, customer.toProps());
    return customer;
  }
  async listStaff(
    page: number,
    limit: number,
    role?: Role,
    depotId?: string,
  ): Promise<{ items: Customer[]; total: number }> {
    const all = [...this.rows.values()]
      .filter((p) => p.status !== CustomerStatus.DELETED)
      .filter((p) => (role ? p.role === role : p.role !== Role.CUSTOMER))
      .filter((p) => (depotId ? p.assignedDepotId === depotId : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const items = all
      .slice((page - 1) * limit, page * limit)
      .map((p) => Customer.fromPersistence({ ...p }));
    return { items, total: all.length };
  }

  async countCustomersCreated(from?: Date, to?: Date): Promise<number> {
    return [...this.rows.values()].filter(
      (p) =>
        p.status !== CustomerStatus.DELETED &&
        p.role === Role.CUSTOMER &&
        (!from || p.createdAt >= from) &&
        (!to || p.createdAt < to),
    ).length;
  }
}

export class InMemoryOtpTokenRepository implements OtpTokenRepository {
  public readonly rows: OtpTokenRecord[] = [];

  // Mirrors the DB's now()-generated createdAt. Accepts a clock so tests that use a
  // FakeClock keep createdAt consistent with the time the service reasons about.
  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(data: CreateOtpTokenData): Promise<OtpTokenRecord> {
    const record: OtpTokenRecord = {
      id: nextId('otp'),
      customerId: data.customerId,
      purpose: data.purpose,
      codeHash: data.codeHash,
      expiresAt: data.expiresAt,
      attempts: 0,
      consumedAt: null,
      createdAt: this.now(),
    };
    this.rows.push(record);
    return record;
  }
  async findActive(customerId: string, purpose: OtpPurpose): Promise<OtpTokenRecord | null> {
    const active = this.rows
      .filter((r) => r.customerId === customerId && r.purpose === purpose && !r.consumedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return active[0] ? { ...active[0] } : null;
  }
  async incrementAttempts(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.attempts += 1;
    }
  }
  async markConsumed(id: string, consumedAt: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.consumedAt = consumedAt;
    }
  }
  async consumeAllForPurpose(customerId: string, purpose: OtpPurpose, at: Date): Promise<void> {
    this.rows
      .filter((r) => r.customerId === customerId && r.purpose === purpose && !r.consumedAt)
      .forEach((r) => {
        r.consumedAt = at;
      });
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  public readonly rows: RefreshTokenRecord[] = [];

  async create(data: CreateRefreshTokenData): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: nextId('rt'),
      customerId: data.customerId,
      tokenHash: data.tokenHash,
      familyId: data.familyId,
      expiresAt: data.expiresAt,
      revokedAt: null,
      replacedById: null,
      userAgent: data.userAgent,
      ipAddress: data.ipAddress,
      createdAt: new Date(),
    };
    this.rows.push(record);
    return { ...record };
  }
  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = this.rows.find((r) => r.tokenHash === tokenHash);
    return row ? { ...row } : null;
  }
  async revoke(id: string, at: Date, replacedById?: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.revokedAt = at;
      row.replacedById = replacedById ?? null;
    }
  }
  async revokeFamily(familyId: string, at: Date): Promise<void> {
    this.rows
      .filter((r) => r.familyId === familyId && !r.revokedAt)
      .forEach((r) => {
        r.revokedAt = at;
      });
  }
  async revokeAllForCustomer(customerId: string, at: Date): Promise<void> {
    this.rows
      .filter((r) => r.customerId === customerId && !r.revokedAt)
      .forEach((r) => {
        r.revokedAt = at;
      });
  }
  async listActiveForCustomer(customerId: string, now: Date): Promise<RefreshTokenRecord[]> {
    return this.rows
      .filter((r) => r.customerId === customerId && !r.revokedAt && r.expiresAt.getTime() > now.getTime())
      .map((r) => ({ ...r }));
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  public readonly entries: AuditLogEntry[] = [];
  public shouldFail = false;
  async record(entry: AuditLogEntry): Promise<void> {
    if (this.shouldFail) {
      throw new Error('audit failure');
    }
    this.entries.push(entry);
  }
  async list(query: AuditLogQuery): Promise<{ items: AuditLogListItem[]; total: number }> {
    const all = this.entries
      .filter((e) => !query.action || e.action === query.action)
      .filter((e) => !query.customerId || e.customerId === query.customerId)
      .map(
        (e, i): AuditLogListItem => ({
          id: `audit-${i}`,
          customerId: e.customerId,
          action: e.action,
          success: e.success,
          ipAddress: e.ipAddress,
          userAgent: e.userAgent,
          metadata: (e.metadata ?? null) as Record<string, unknown> | null,
          createdAt: new Date(),
          actorEmail: null,
          actorName: null,
          actorRole: null,
        }),
      )
      .reverse();
    const start = (query.page - 1) * query.limit;
    return { items: all.slice(start, start + query.limit), total: all.length };
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}

/** Build a real AuthConfigService backed by an in-memory env map. */
export function buildTestConfig(overrides: Record<string, string> = {}): AuthConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    AUTH_SERVICE_PORT: '3001',
    AUTH_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-1',
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL: '2592000',
    OTP_TTL_SECONDS: '300',
    OTP_LENGTH: '6',
    OTP_MAX_ATTEMPTS: '5',
    OTP_RESEND_COOLDOWN_SECONDS: '60',
    OTP_DELIVERY_CHANNEL: 'console',
    OTP_PEPPER: 'test-otp-pepper-value',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    ...overrides,
  };
  const fakeConfigService = {
    get: <T>(key: string, fallback?: T): T => (env[key] as unknown as T) ?? (fallback as T),
    getOrThrow: (key: string): string => {
      const value = env[key];
      if (value === undefined) {
        throw new Error(`Missing config ${key}`);
      }
      return value;
    },
  };
  return new AuthConfigService(fakeConfigService as unknown as ConfigService);
}

export const resetIdCounter = (): void => {
  idCounter = 0;
};

/** Build a customer entity with sensible defaults for tests. */
export function makeCustomer(overrides: Partial<ReturnType<Customer['toProps']>> = {}): Customer {
  const now = new Date();
  return Customer.fromPersistence({
    id: nextId('cust'),
    phone: '+6281234567890',
    email: null,
    fullName: null,
    role: Role.CUSTOMER,
    status: CustomerStatus.ACTIVE,
    googleSub: null,
    avatarUrl: null,
    assignedDepotId: null,
    phoneVerifiedAt: now,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}
