import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SERVICE_REGISTRY } from './service-registry';

@Injectable()
export class AdminConfigService {
  constructor(private readonly config: ConfigService) {}

  private num(key: string): number {
    return Number(this.config.getOrThrow(key));
  }

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get port(): number {
    return this.num('ADMIN_SERVICE_PORT');
  }
  get corsOrigins(): string[] {
    return this.config
      .get<string>('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  }
  get rateLimit(): { ttlSeconds: number; limit: number } {
    return { ttlSeconds: this.num('RATE_LIMIT_TTL_SECONDS'), limit: this.num('RATE_LIMIT_MAX') };
  }
  /** Shared service-to-service secret (blank when unset). */
  /**
   * Peers the scheduled-report sweep reads its rows from. Blank either one and that
   * dataset's run is recorded FAILED — never an empty spreadsheet, which would read as a
   * quiet month rather than an outage.
   */
  get orderServiceUrl(): string {
    return this.config.get<string>('ORDER_SERVICE_URL', '').trim();
  }
  get paymentServiceUrl(): string {
    return this.config.get<string>('PAYMENT_SERVICE_URL', '').trim();
  }

  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }

  /** auth-service base URL, trailing slashes stripped. Blank disables audit recording. */
  get authServiceUrl(): string {
    return this.config.get<string>('AUTH_SERVICE_URL', '').trim().replace(/\/+$/, '');
  }

  /**
   * Peer services to probe for the aggregate health roll-up (13b): name -> base URL
   * (trailing slashes stripped). Only services whose *_SERVICE_URL is configured are
   * included; the rest are simply absent from the roll-up.
   */
  serviceRegistry(): { name: string; baseUrl: string }[] {
    const out: { name: string; baseUrl: string }[] = [];
    for (const { name, envKey } of SERVICE_REGISTRY) {
      const url = this.config.get<string>(envKey);
      if (url) out.push({ name, baseUrl: url.replace(/\/+$/, '') });
    }
    return out;
  }

  /**
   * Fraud scan thresholds (15b).
   *
   * Configuration, not literals: the numbers below decide whether a real customer lands in
   * a review queue, and nobody has tuned them against real data yet. Env-declared and
   * validated like every other tunable this platform has before it earns a per-depot
   * setting — changeable without shipping code, and visible in the env contract.
   */
  get fraudScan(): { windowDays: number; minRefunds: number; highRefunds: number } {
    return {
      windowDays: Number(this.config.get('FRAUD_SCAN_WINDOW_DAYS', 30)),
      minRefunds: Number(this.config.get('FRAUD_SCAN_MIN_REFUNDS', 3)),
      highRefunds: Number(this.config.get('FRAUD_SCAN_HIGH_REFUNDS', 5)),
    };
  }

  /** Base URL of one peer, or '' when this environment does not reach it. */
  serviceUrl(envKey: string): string {
    return (this.config.get<string>(envKey) ?? '').replace(/\/+$/, '');
  }
}
