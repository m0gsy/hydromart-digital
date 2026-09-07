import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BUSINESS_TIME_ZONE, SettingsCache } from '@hydromart/platform';

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
  private tunable(key: string, envValue: number, depotId: string | null): number {
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
  /** The one business timezone (H-16). Every day/month boundary here is reckoned in it. */
  /**
   * The one place a courier receipt may come from.
   *
   * `isAutoApproved` treats "a receipt is attached" as proof enough to credit a courier's
   * ledger with no reviewer, and the only thing behind that was a non-empty string — so the
   * literal `x` bought an auto-approval. Then it was "any http(s) URL", which a hand-typed
   * one still satisfies. This is the actual answer: the URL has to live where THIS platform
   * put it, which is the same object storage the courier app uploads to.
   *
   * EMPTY = auto-approve is OFF. Fail closed on purpose: an unconfigured deployment cannot
   * tell a real receipt from a typed one, and the safe reading of "I cannot tell" is a
   * claim that waits for a human, not one that pays itself.
   */
  get receiptStorageBaseUrl(): string {
    return this.config.get<string>('RECEIPT_STORAGE_BASE_URL', '').replace(/\/+$/, '');
  }

  get businessTimeZone(): string {
    return this.config.get<string>('PRICING_TZ', BUSINESS_TIME_ZONE);
  }
  /**
   * Expense claims at or under this IDR amount auto-approve (0 = always needs a reviewer).
   *
   * CA-4-21, owner decision 2026-09-04: Rp 50.000 is the NETWORK ceiling and a depot may
   * only LOWER it. `effective()` resolves DEPOT over GLOBAL over env, and by itself it
   * would happily serve a depot override of Rp 5.000.000 — a manager holds `depotAdmin`
   * and `expenseApprove` both, so the same person could raise their own depot's bar and
   * then approve nothing. The clamp is what makes "boleh menurunkannya" mean only that.
   *
   * The network figure is the GLOBAL setting if head office has set one, else the env
   * default — never a depot's own number, or the ceiling would be whatever it is measured
   * against.
   */
  expenseAutoApproveMaxIdr(depotId: string | null = null): number {
    const envValue = this.num('EXPENSE_AUTO_APPROVE_MAX_IDR');
    const network = this.tunable('expenseAutoApproveMaxIdr', envValue, null);
    if (depotId === null) return network;
    return Math.min(this.tunable('expenseAutoApproveMaxIdr', envValue, depotId), network);
  }
}
