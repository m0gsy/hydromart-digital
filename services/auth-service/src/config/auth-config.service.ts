import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type OtpDeliveryChannel = 'console' | 'whatsapp' | 'sms';

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

  get googleClientId(): string | undefined {
    const value = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    return value && value.length > 0 ? value : undefined;
  }

  get whatsapp(): { baseUrl: string; token: string; template: string } {
    return {
      baseUrl: this.config.get<string>('WHATSAPP_API_BASE_URL', ''),
      token: this.config.get<string>('WHATSAPP_API_TOKEN', ''),
      template: this.config.get<string>('WHATSAPP_OTP_TEMPLATE', 'hydromart_otp'),
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
}
