import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CrmConfigService {
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
    return this.num('CRM_SERVICE_PORT');
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
  /**
   * WhatsApp Cloud API base URL + bearer token (FR-094). A blank baseUrl selects the
   * broadcast adapter's console/dev mode (logs the message, reports success).
   */
  get whatsapp(): { baseUrl: string; token: string } {
    return {
      baseUrl: this.config.get<string>('WHATSAPP_API_URL', ''),
      token: this.config.get<string>('WHATSAPP_API_TOKEN', ''),
    };
  }
  /**
   * customer-service base URL for the CRM broadcast directory (FR-087 segmentation). Blank
   * disables segment targeting — a segment request then fails closed (SegmentUnavailableError).
   */
  get customerServiceUrl(): string {
    return this.config.get<string>('CUSTOMER_SERVICE_URL', '').trim();
  }

  /**
   * VAPID keypair + subject for Web Push (design 7b transport). Blank public/private keys
   * disable push (the adapter no-ops); the app still stores notifications + sends WhatsApp.
   */
  get vapid(): { publicKey: string; privateKey: string; subject: string } {
    return {
      publicKey: this.config.get<string>('VAPID_PUBLIC_KEY', '').trim(),
      privateKey: this.config.get<string>('VAPID_PRIVATE_KEY', '').trim(),
      subject: this.config.get<string>('VAPID_SUBJECT', 'mailto:ops@hydromart.id').trim(),
    };
  }
}
