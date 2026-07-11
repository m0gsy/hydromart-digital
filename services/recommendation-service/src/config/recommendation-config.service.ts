import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RecommendationConfigService {
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
    return this.num('RECOMMENDATION_SERVICE_PORT');
  }
  get databaseUrl(): string {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }
  get jwtAccessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /** order-service base URL; used later for the completed-orders rebuild feed. */
  get orderServiceUrl(): string {
    return this.config.get<string>('ORDER_SERVICE_URL', '').replace(/\/+$/, '');
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
}
