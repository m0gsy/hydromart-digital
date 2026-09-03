import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type OtpDeliveryChannel = 'console' | 'sms' | 'zenziva';

export interface OtpPolicy {
  ttlSeconds: number;
  length: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
}

export interface TokenPolicy {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

/**
 * Strongly-typed accessor over validated configuration. Injecting this instead of
 * raw `ConfigService` gives call sites type safety and a single source of truth
 * for defaults (no magic numbers scattered across the codebase).
 */
@Injectable()
export class AuthConfigService {
  constructor(private readonly config: ConfigService) {}

  private num(key: string): number {
    return Number(this.config.getOrThrow(key));
  }

  private str(key: string): string {
    return String(this.config.getOrThrow(key));
  }

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.num('AUTH_SERVICE_PORT');
  }

  get otpPolicy(): OtpPolicy {
    return {
      ttlSeconds: this.num('OTP_TTL_SECONDS'),
      length: this.num('OTP_LENGTH'),
      maxAttempts: this.num('OTP_MAX_ATTEMPTS'),
      resendCooldownSeconds: this.num('OTP_RESEND_COOLDOWN_SECONDS'),
    };
  }

  /**
   * J6: the phone numbers that get a fixed OTP, so a Play reviewer who cannot receive an
   * Indonesian SMS can still sign in. Null unless BOTH values are set — the feature has
   * to be impossible to half-enable, because half-enabled looks identical to working right
   * up until a reviewer tries it.
   *
   * A comma-separated list, not one number: the two binaries need two demo accounts (the
   * customer app a CUSTOMER, Ops a staff role) and one phone carries one role. With a
   * single slot the two Play reviews cannot run at the same time. One code covers all of
   * them — it is rotated the moment review ends, and per-number codes would only add a
   * way to mistype one.
   */
  get reviewerOtp(): { phones: string[]; code: string } | null {
    const phones = this.config
      .get<string>('REVIEWER_PHONE', '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const code = this.config.get<string>('REVIEWER_OTP_CODE', '').trim();
    return phones.length && code ? { phones, code } : null;
  }

  get otpDeliveryChannel(): OtpDeliveryChannel {
    return this.config.get<OtpDeliveryChannel>('OTP_DELIVERY_CHANNEL', 'console');
  }

  get otpPepper(): string {
    return this.str('OTP_PEPPER');
  }

  get tokenPolicy(): TokenPolicy {
    return {
      accessSecret: this.str('JWT_ACCESS_SECRET'),
      refreshSecret: this.str('JWT_REFRESH_SECRET'),
      accessTtlSeconds: this.num('JWT_ACCESS_TTL'),
      refreshTtlSeconds: this.num('JWT_REFRESH_TTL'),
    };
  }

  get zenziva(): { baseUrl: string; userkey: string; passkey: string } {
    return {
      baseUrl: this.config.get<string>('ZENZIVA_BASE_URL', 'https://console.zenziva.net'),
      userkey: this.config.get<string>('ZENZIVA_USERKEY', ''),
      passkey: this.config.get<string>('ZENZIVA_PASSKEY', ''),
    };
  }

  get sms(): { baseUrl: string; token: string; senderId: string } {
    return {
      baseUrl: this.config.get<string>('SMS_API_BASE_URL', ''),
      token: this.config.get<string>('SMS_API_TOKEN', ''),
      senderId: this.config.get<string>('SMS_SENDER_ID', 'HYDROMART'),
    };
  }

  // crm-service base URL + shared internal-service key for the registration welcome.
  // Both blank in dev = welcome notification disabled (adapter no-ops, fail-open).
  get customerNotifications(): { crmUrl: string; internalKey: string } {
    return {
      crmUrl: this.config.get<string>('CRM_SERVICE_URL', ''),
      internalKey: this.config.get<string>('INTERNAL_SERVICE_KEY', ''),
    };
  }

  /**
   * CA-2-06: admin-service, for the idle-session limit head office set.
   *
   * Blank in dev = no idle limit, and the adapter says so rather than logging on every
   * refresh. In production a blank URL is still a fail-OPEN: the env-driven refresh TTL
   * bounds every session regardless, so the floor is a weaker limit, never none.
   */
  get securityPolicySource(): { adminServiceUrl: string; internalServiceKey: string } {
    return {
      adminServiceUrl: this.config.get<string>('ADMIN_SERVICE_URL', '').trim().replace(/\/+$/, ''),
      internalServiceKey: this.config.get<string>('INTERNAL_SERVICE_KEY', ''),
    };
  }

  /**
   * customer-service, for the PDP export/anonymise fan-out (item 13). A blank URL is a
   * hard failure at call time, not a silent skip: an export that quietly omits the
   * customer's addresses, or a deletion that leaves them behind, is worse than an error.
   */
  get customerData(): { customerUrl: string; internalKey: string } {
    return {
      customerUrl: this.config.get<string>('CUSTOMER_SERVICE_URL', ''),
      internalKey: this.config.get<string>('INTERNAL_SERVICE_KEY', ''),
    };
  }

  /**
   * hr-service, so an invited staff account also becomes an employee HR can pay and
   * roster. Blank URL fails the invite rather than creating half a person — the same
   * fail-closed rule hr-service already applies to AUTH_SERVICE_URL in the other
   * direction.
   */
  /**
   * Base URL of one peer, or an empty string when this environment does not reach it.
   *
   * The erasure registry needs six peers by name and has to be able to say "this one is
   * not configured here" — an unreachable owner is reported UNENFORCED, never skipped.
   */
  serviceUrl(envKey: string): string {
    return (this.config.get<string>(envKey) ?? '').replace(/\/+$/, '');
  }

  get hrDirectory(): { hrUrl: string; internalKey: string } {
    return {
      hrUrl: this.config.get<string>('HR_SERVICE_URL', ''),
      internalKey: this.config.get<string>('INTERNAL_SERVICE_KEY', ''),
    };
  }

  // Shared service-to-service secret guarding inbound internal endpoints
  // (e.g. cross-service audit ingest). Blank = those endpoints reject everything.
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }

  get corsOrigins(): string[] {
    return this.config
      .get<string>('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  get rateLimit(): { ttlSeconds: number; limit: number } {
    return {
      ttlSeconds: this.num('RATE_LIMIT_TTL_SECONDS'),
      limit: this.num('RATE_LIMIT_MAX'),
    };
  }

  get storageLocalDir(): string {
    return this.config.get<string>('STORAGE_LOCAL_DIR', './var/uploads');
  }
  get storagePublicBaseUrl(): string {
    return this.config
      .get<string>('STORAGE_PUBLIC_BASE_URL', 'http://localhost:3001')
      .replace(/\/+$/, '');
  }
  get storageDriver(): 'local' | 's3' {
    return this.config.get<string>('STORAGE_DRIVER', 'local') === 's3' ? 's3' : 'local';
  }
  get s3(): {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  } {
    return {
      endpoint: this.config.getOrThrow<string>('STORAGE_S3_ENDPOINT'),
      region: this.config.get<string>('STORAGE_S3_REGION', 'auto'),
      bucket: this.config.getOrThrow<string>('STORAGE_S3_BUCKET'),
      accessKeyId: this.config.getOrThrow<string>('STORAGE_S3_ACCESS_KEY_ID'),
      secretAccessKey: this.config.getOrThrow<string>('STORAGE_S3_SECRET_ACCESS_KEY'),
    };
  }
}
