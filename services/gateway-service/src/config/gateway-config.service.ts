import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NATIVE_ORIGINS } from '../routing/session-bff';

/**
 * Maps a public path segment (`/{segment}/...`) to the env var holding the
 * upstream base URL it proxies to. Segment names are plural/public-facing;
 * the env var names follow each service's own convention.
 */
const SEGMENT_ENV: Record<string, string> = {
  auth: 'AUTH_SERVICE_URL',
  customers: 'CUSTOMER_SERVICE_URL',
  products: 'PRODUCT_SERVICE_URL',
  orders: 'ORDER_SERVICE_URL',
  payments: 'PAYMENT_SERVICE_URL',
  deliveries: 'DELIVERY_SERVICE_URL',
  depots: 'DEPOT_SERVICE_URL',
  // Depot operational incidents inbox (depot-service, design 6b/13b). Its own public
  // segment; reuses the depot-service upstream (no new env var).
  incidents: 'DEPOT_SERVICE_URL',
  // Depot-manager approval queue (depot-service, design 1c/2a-2c). Own public segment,
  // reuses the depot-service upstream (no new env var).
  approvals: 'DEPOT_SERVICE_URL',
  dashboard: 'DASHBOARD_SERVICE_URL',
  loyalty: 'LOYALTY_SERVICE_URL',
  vouchers: 'PROMO_SERVICE_URL',
  referrals: 'REFERRAL_SERVICE_URL',
  crm: 'CRM_SERVICE_URL',
  recommendations: 'RECOMMENDATION_SERVICE_URL',
  forecast: 'FORECAST_SERVICE_URL',
  payout: 'PAYOUT_SERVICE_URL',
  admin: 'ADMIN_SERVICE_URL',
  // Depot procurement: purchase orders + supplier directory (depot-service, design 7a/9d/11b).
  // Own public segment; reuses the depot-service upstream (no new env var).
  procurement: 'DEPOT_SERVICE_URL',
  // Courier shift roster (depot-service, design 6d/7b). Own public segment; reuses the
  // depot-service upstream (no new env var).
  shifts: 'DEPOT_SERVICE_URL',
  // hr-service (HRIS Lite): employees, face-recognition attendance, payroll, bonus/deduction,
  // salary config, HR reports. Several public segments, one upstream.
  hr: 'HR_SERVICE_URL',
  employees: 'HR_SERVICE_URL',
  attendance: 'HR_SERVICE_URL',
  payroll: 'HR_SERVICE_URL',
  bonuses: 'HR_SERVICE_URL',
  deductions: 'HR_SERVICE_URL',
  allowances: 'HR_SERVICE_URL',
  // Kasbon + the bonus-rule engine. Both were reachable only inside the cluster until now —
  // the console has been calling them through the gateway all along.
  loans: 'HR_SERVICE_URL',
  'bonus-rules': 'HR_SERVICE_URL',
  performance: 'HR_SERVICE_URL',
  'hr-reports': 'HR_SERVICE_URL',
  'hr-audit': 'HR_SERVICE_URL',
  holidays: 'HR_SERVICE_URL',
  leave: 'HR_SERVICE_URL',
  'hr-shifts': 'HR_SERVICE_URL',
  departments: 'HR_SERVICE_URL',
  'employee-documents': 'HR_SERVICE_URL',
  'employee-assets': 'HR_SERVICE_URL',
  announcements: 'HR_SERVICE_URL',
  'shift-rotations': 'HR_SERVICE_URL',
};

@Injectable()
export class GatewayConfigService {
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
    return this.num('GATEWAY_PORT');
  }
  /**
   * F2: the two Capacitor origins are appended here rather than added to
   * `CORS_ALLOWED_ORIGINS` on every deployment. They are constants of the platform, not
   * a per-environment choice, and an env var that must be edited by hand on the VPS is
   * an env var that will be forgotten — the failure mode being every request from the
   * shipped app failing CORS with no server-side error to find.
   *
   * Safe to allow unconditionally: session cookies are `sameSite: 'lax'`, so a page that
   * really is served from `https://localhost` still cannot ride a signed-in browser
   * session; it can only make the same anonymous calls any origin can.
   */
  /**
   * F5: what `GET /mobile-config` answers. Reading it from env means the kill switch is
   * an env edit and a container restart — no rebuild, no Play review, no waiting for
   * users to update. Which is the entire point of having it.
   */
  get mobile(): { minVersionCode: number; updateMessage: string } {
    return {
      minVersionCode: Number(this.config.get<string>('MOBILE_MIN_VERSION_CODE', '0')),
      updateMessage: this.config.get<string>('MOBILE_UPDATE_MESSAGE', '').trim(),
    };
  }

  get corsOrigins(): string[] {
    const configured = this.config
      .get<string>('CORS_ALLOWED_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    return [...new Set([...configured, ...NATIVE_ORIGINS])];
  }
  get rateLimit(): { ttlSeconds: number; limit: number } {
    return { ttlSeconds: this.num('RATE_LIMIT_TTL_SECONDS'), limit: this.num('RATE_LIMIT_MAX') };
  }

  /** service segment -> upstream base URL (trailing slashes stripped). */
  upstreams(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [segment, envKey] of Object.entries(SEGMENT_ENV)) {
      map[segment] = this.config.getOrThrow<string>(envKey).replace(/\/+$/, '');
    }
    return map;
  }
}
