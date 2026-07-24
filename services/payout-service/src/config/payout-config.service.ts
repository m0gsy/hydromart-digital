import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { SETTING_DEF_BY_KEY } from './setting-defs';

@Injectable()
export class PayoutConfigService {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsCache,
  ) {}

  private num(key: string): number {
    return Number(this.config.getOrThrow(key));
  }

  /**
   * Effective business value: depot override ?? global override ?? `envValue`.
   * `envValue` is always the getter's own current ENV read (not
   * `SETTING_DEF_BY_KEY[key].envDefault` — that field is only the UI's documented
   * default and, for a couple of keys, intentionally differs from the real ENV
   * default; using it here would silently change today's behavior).
   */
  private tunable(key: string, envValue: number, depotId: string | null = null): number {
    const def = SETTING_DEF_BY_KEY[key];
    return this.settings.effective(key, def.type, envValue, depotId) as number;
  }

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get port(): number {
    return this.num('PAYOUT_SERVICE_PORT');
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
  /** HQ commission rate on gross sales (reporting only), default 5%. */
  get commissionRate(): number {
    return Number(this.config.get<string>('PAYOUT_COMMISSION_RATE', '0.05'));
  }
  /** Expense claims at or under this IDR amount auto-approve (0 = always needs a reviewer). */
  expenseAutoApproveMaxIdr(depotId: string | null = null): number {
    return this.tunable('expenseAutoApproveMaxIdr', this.num('EXPENSE_AUTO_APPROVE_MAX_IDR'), depotId);
  }
}
