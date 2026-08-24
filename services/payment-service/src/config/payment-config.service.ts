import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_REFUND_APPROVAL_THRESHOLD } from '../domain/payment';

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
  get storageLocalDir(): string {
    return this.config.get<string>('STORAGE_LOCAL_DIR', './var/uploads');
  }
  get storagePublicBaseUrl(): string {
    return this.config
      .get<string>('STORAGE_PUBLIC_BASE_URL', 'http://localhost:3004')
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
  /** C2: where to ask which drawer is open. Empty leaves counter payments unattributed. */
  get depotServiceUrl(): string {
    return this.config.get<string>('DEPOT_SERVICE_URL', '').replace(/\/+$/, '');
  }
  /**
   * K2.2: how long a non-cash PENDING payment may sit before the sweep fails it.
   *
   * Zero disables the sweep entirely and restores the old behaviour exactly — that is the
   * kill switch, and it costs nothing because "never expire" is what this used to do.
   */
  get pendingPaymentTtlHours(): number {
    return Number(this.config.get<string>('PAYMENT_PENDING_TTL_HOURS', '24'));
  }
  get internalServiceKey(): string {
    return this.config.get<string>('INTERNAL_SERVICE_KEY', '');
  }
  /**
   * Refunds above this IDR amount require HQ approval (feature 14a).
   *
   * Q-11: the default was the literal `100_000` here while
   * DEFAULT_REFUND_APPROVAL_THRESHOLD in domain/payment.ts documented itself as the
   * source of truth. Two numbers, one of them wrong the moment either moved.
   */
  get refundApprovalThreshold(): number {
    const raw = Number(this.config.get<string>('REFUND_HQ_THRESHOLD'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REFUND_APPROVAL_THRESHOLD;
  }
  get authServiceUrl(): string {
    return this.config.get<string>('AUTH_SERVICE_URL', '').replace(/\/+$/, '');
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
