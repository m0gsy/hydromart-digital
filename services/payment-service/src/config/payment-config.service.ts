import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentConfigService {
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
    return this.num('PAYMENT_SERVICE_PORT');
  }
  get gatewayBaseUrl(): string {
    return this.config.get<string>('PAYMENT_GATEWAY_BASE_URL', '').replace(/\/+$/, '');
  }
  get gatewayApiKey(): string {
    return this.config.get<string>('PAYMENT_GATEWAY_API_KEY', '');
  }
  get webhookSecret(): string {
    return this.config.getOrThrow<string>('PAYMENT_WEBHOOK_SECRET');
  }
  get orderServiceUrl(): string {
    return this.config.get<string>('ORDER_SERVICE_URL', '').replace(/\/+$/, '');
  }
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /** Refunds above this IDR amount require HQ approval (feature 14a). Default Rp 100k. */
  get refundApprovalThreshold(): number {
    const raw = Number(this.config.get<string>('REFUND_HQ_THRESHOLD'));
    return Number.isFinite(raw) && raw > 0 ? raw : 100_000;
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
