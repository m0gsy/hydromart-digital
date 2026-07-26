import {
  DuplicateVoucherCodeError,
  InvalidVoucherValueError,
  MinSpendNotMetError,
  PromotionNotFoundError,
  VoucherBudgetExhaustedError,
  VoucherCustomerLimitReachedError,
  VoucherExpiredError,
  VoucherInactiveError,
  VoucherNotFoundError,
  VoucherNotStartedError,
  VoucherRequestDecidedError,
  VoucherRequestNotFoundError,
  VoucherUsageExceededError,
} from '../../src/domain/errors';
import { buildPage } from '../../src/application/pagination';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { buildTestConfig } from '../support/fakes';

describe('buildPage', () => {
  it('computes totalPages by dividing total over limit', () => {
    const page = buildPage([1, 2], 25, 2, 10);
    expect(page).toEqual({ items: [1, 2], total: 25, page: 2, limit: 10, totalPages: 3 });
  });

  it('never reports fewer than one page even with zero total', () => {
    expect(buildPage([], 0, 1, 10).totalPages).toBe(1);
  });
});

describe('domain errors', () => {
  it('each error carries its code, status, and a message', () => {
    const cases = [
      [new VoucherNotFoundError(), 'VOUCHER_NOT_FOUND'],
      [new DuplicateVoucherCodeError('HEMAT10'), 'VOUCHER_CODE_TAKEN'],
      [new InvalidVoucherValueError(), 'VOUCHER_VALUE_INVALID'],
      [new PromotionNotFoundError(), 'PROMOTION_NOT_FOUND'],
      [new VoucherInactiveError(), 'VOUCHER_INACTIVE'],
      [new VoucherNotStartedError(), 'VOUCHER_NOT_STARTED'],
      [new VoucherExpiredError(), 'VOUCHER_EXPIRED'],
      [new MinSpendNotMetError(50000), 'VOUCHER_MIN_SPEND'],
      [new VoucherUsageExceededError(), 'VOUCHER_USAGE_EXCEEDED'],
      [new VoucherCustomerLimitReachedError(), 'VOUCHER_CUSTOMER_LIMIT'],
      [new VoucherBudgetExhaustedError(), 'VOUCHER_BUDGET_EXHAUSTED'],
      [new VoucherRequestNotFoundError(), 'VOUCHER_REQUEST_NOT_FOUND'],
      [new VoucherRequestDecidedError(), 'VOUCHER_REQUEST_DECIDED'],
    ] as const;
    for (const [err, code] of cases) {
      expect(err.code).toBe(code);
      expect(typeof err.status).toBe('number');
      expect(err.message.length).toBeGreaterThan(0);
    }
    expect(new DuplicateVoucherCodeError('HEMAT10').message).toContain('HEMAT10');
    expect(new MinSpendNotMetError(50000).message).toContain('50000');
  });
});

describe('PrismaService lifecycle', () => {
  it('connects on init and disconnects on destroy', async () => {
    const svc = new PrismaService();
    const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined as never);
    const disconnect = jest.spyOn(svc, '$disconnect').mockResolvedValue(undefined as never);

    await svc.onModuleInit();
    await svc.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('PromoConfigService', () => {
  it('exposes typed config values and defaults', () => {
    const config = buildTestConfig({ NODE_ENV: 'production', ORDER_SERVICE_URL: 'http://order/' });
    expect(config.nodeEnv).toBe('production');
    expect(config.isProduction).toBe(true);
    expect(config.port).toBe(3010);
    expect(config.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
    expect(config.internalServiceKey).toBe('');
    expect(config.crmServiceUrl).toBe('');
    expect(config.customerServiceUrl).toBe('');
    // trailing slashes are trimmed off the order-service base url
    expect(config.orderServiceUrl).toBe('http://order');
  });

  it('defaults isProduction to false and parses/trims CORS origins', () => {
    const config = buildTestConfig({
      NODE_ENV: 'test',
      CORS_ALLOWED_ORIGINS: 'http://a.test , http://b.test ,',
    });
    expect(config.isProduction).toBe(false);
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });
});

describe('envValidationSchema', () => {
  it('accepts a valid env and applies defaults', () => {
    const { error, value } = envValidationSchema.validate({
      PROMO_DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      ORDER_SERVICE_URL: 'http://localhost:3004',
    });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PROMO_SERVICE_PORT).toBe(3010);
  });

  it('rejects when the required ORDER_SERVICE_URL is missing', () => {
    const { error } = envValidationSchema.validate({
      PROMO_DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
    });
    expect(error).toBeDefined();
  });
});
