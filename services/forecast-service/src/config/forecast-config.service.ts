import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ForecastConfigService {
  constructor(private readonly config: ConfigService) {}

  private num(key: string): number {
    return Number(this.config.getOrThrow(key));
  }

  /** One business zone for the whole platform; day buckets are cut here (C2). */
  get businessTimeZone(): string {
    return this.config.get<string>('PRICING_TZ', 'Asia/Jakarta');
  }

  /**
   * PR-J. Which demand model a depot's forecast is produced by, defaulting to the
   * heuristic that has always run. Per depot, because that is the only safe way to try a
   * candidate: turn it on for one depot, measure it against the depot next door, turn it
   * off again — all without a deploy.
   *
   * A per-depot settings STORE would be the eventual home; this reads a JSON map from the
   * environment instead, because forecast-service has no settings client and adding an
   * inter-service call on the forecast request path to answer "which model" would cost
   * more than the feature. `{"<depotId>":"moving-average"}`; a malformed value is ignored
   * rather than thrown — a typo here must not take a depot's stock screen down.
   */
  get forecastModel(): string {
    return this.config.get<string>('FORECAST_MODEL', 'heuristic');
  }

  forecastModelForDepot(depotId: string | null | undefined): string {
    if (!depotId) return this.forecastModel;
    const raw = this.config.get<string>('FORECAST_MODEL_BY_DEPOT', '');
    if (!raw) return this.forecastModel;
    try {
      const map = JSON.parse(raw) as Record<string, string>;
      return map[depotId] ?? this.forecastModel;
    } catch {
      return this.forecastModel;
    }
  }

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get port(): number {
    return this.num('FORECAST_SERVICE_PORT');
  }
  get databaseUrl(): string {
    return this.config.getOrThrow<string>('FORECAST_DATABASE_URL');
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
  /** auth-service base URL; used to put a name on each churn row (§G-3). */
  get authServiceUrl(): string {
    return this.config.get<string>('AUTH_SERVICE_URL', '').replace(/\/+$/, '');
  }
  /** depot-service base URL; used to resolve a franchise owner's depots for the ownership check. */
  get depotServiceUrl(): string {
    return this.config.get<string>('DEPOT_SERVICE_URL', '').replace(/\/+$/, '');
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
  /** Default recency window (days) for churn risk banding; the query `days` param overrides it. */
  get churnWindowDays(): number {
    return Number(this.config.get<number>('CHURN_WINDOW_DAYS', 45));
  }
  /** Lifetime-spend (rupiah) at which the churn Monetary factor reaches full dampening. */
  get churnMonetaryRef(): number {
    return Number(this.config.get<number>('CHURN_MONETARY_REF_RUPIAH', 500_000));
  }
}
