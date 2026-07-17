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
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
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
}
