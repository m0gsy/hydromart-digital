import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '@hydromart/platform';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { PromoModule } from '../../src/modules/promo.module';
import { PROMO_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { InMemoryPromotionRepository, InMemoryVoucherRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-0123456789';

/**
 * Fix 10: the two auto-apply routes are internal-only (`/auto-apply/quote`,
 * `/auto-apply/apply`) — a write path into a financial table (promo_applications) that
 * relies entirely on @UseGuards(InternalAuthGuard) being wired. Nothing proved that guard
 * actually sits in front of it. Mirrors the equivalent 401 test for the voucher redeem
 * route in voucher.e2e.spec.ts.
 *
 * `/auto-apply/apply`'s 401 coverage lands here now that its DTO (AutoApplyApplyDto/
 * AppliedLineDto) is final — see the data-contract redesign fix batch.
 */
describe('Promo rule auto-apply HTTP flows (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    const prismaStub = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              PROMO_SERVICE_PORT: 3010,
              PROMO_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
            }),
          ],
        }),
        PromoModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(PROMO_TOKENS.VoucherRepository)
      .useValue(new InMemoryVoucherRepository())
      .overrideProvider(PROMO_TOKENS.PromotionRepository)
      .useValue(new InMemoryPromotionRepository())
      // The 200/204 cases below exercise PromoRuleService.quote()/apply() end to end through
      // the HTTP pipeline; the stubbed PrismaService has no real `promoRule` model, so this
      // fake stands in exactly like the other two repositories above.
      .overrideProvider(PROMO_TOKENS.PromoRuleRepository)
      .useValue({
        findActiveCandidates: jest.fn().mockResolvedValue([]),
        hasApplicationFor: jest.fn().mockResolvedValue(false),
        recordApplications: jest.fn().mockResolvedValue(undefined),
        usageByRule: jest
          .fn()
          .mockResolvedValue([
            { promoRuleId: 'r1', orders: 2, totalDiscount: 5000, lastAppliedAt: new Date('2026-10-08T01:00:00Z') },
          ]),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const internal = (k: string) => ({ 'x-internal-key': k });

  const quoteBody = {
    channel: 'APP',
    lines: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1, unitPrice: 8000 }],
  };

  describe('admin usage + simulate', () => {
    const token = (role: Role) => {
      const jwt = app.get(JwtService);
      const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
      return jwt.sign(
        { sub: '00000000-0000-4000-8000-000000000098', role, phone: '+62' },
        { secret, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
      );
    };

    it('GET promo-rules/usage is reachable (not read as an id) and serialises the date', async () => {
      const res = await request(server())
        .get('/api/v1/promotions/promo-rules/usage')
        .set(auth(token(Role.SUPER_ADMIN)))
        .expect(200);
      expect(res.body).toEqual([
        { promoRuleId: 'r1', orders: 2, totalDiscount: 5000, lastAppliedAt: '2026-10-08T01:00:00.000Z' },
      ]);
    });

    it('both routes refuse a customer', async () => {
      await request(server()).get('/api/v1/promotions/promo-rules/usage').set(auth(token(Role.CUSTOMER))).expect(403);
      await request(server())
        .post('/api/v1/promotions/promo-rules/simulate')
        .set(auth(token(Role.CUSTOMER)))
        .send(quoteBody)
        .expect(403);
    });

    it('simulate answers with the quote shape and validates the body', async () => {
      const ok = await request(server())
        .post('/api/v1/promotions/promo-rules/simulate')
        .set(auth(token(Role.SUPER_ADMIN)))
        .send({ ...quoteBody, occurredAt: '2026-10-09T02:30:00.000Z' })
        .expect(200);
      expect(ok.body).toMatchObject({ lines: [expect.any(Object)], shippingFeeOverride: null });
      await request(server())
        .post('/api/v1/promotions/promo-rules/simulate')
        .set(auth(token(Role.SUPER_ADMIN)))
        .send({ ...quoteBody, channel: 'WEB' })
        .expect(400);
    });
  });

  it('requires the internal service key for auto-apply/quote (401 without/wrong key)', async () => {
    await request(server()).post('/api/v1/promotions/auto-apply/quote').send(quoteBody).expect(401);

    await request(server())
      .post('/api/v1/promotions/auto-apply/quote')
      .set(internal('wrong-key'))
      .send(quoteBody)
      .expect(401);

    // Even an otherwise-valid customer bearer token must not substitute for the internal key.
    const jwt = app.get(JwtService);
    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const customerToken = jwt.sign(
      { sub: '00000000-0000-4000-8000-000000000099', role: Role.CUSTOMER, phone: '+62' },
      { secret, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
    );
    await request(server())
      .post('/api/v1/promotions/auto-apply/quote')
      .set(auth(customerToken))
      .send(quoteBody)
      .expect(401);
  });

  it('accepts a request with the correct internal key', async () => {
    await request(server())
      .post('/api/v1/promotions/auto-apply/quote')
      .set(internal(INTERNAL_KEY))
      .send(quoteBody)
      .expect(200);
  });

  const applyBody = {
    orderId: '00000000-0000-4000-8000-000000000002',
    lines: [
      {
        productId: '00000000-0000-4000-8000-000000000001',
        unitPrice: 8000,
        quantity: 1,
        appliedRuleIds: [],
        unitPriceAfter: 8000,
        freeQty: 0,
      },
    ],
  };

  it('requires the internal service key for auto-apply/apply (401 without/wrong key)', async () => {
    await request(server()).post('/api/v1/promotions/auto-apply/apply').send(applyBody).expect(401);

    await request(server())
      .post('/api/v1/promotions/auto-apply/apply')
      .set(internal('wrong-key'))
      .send(applyBody)
      .expect(401);

    // Even an otherwise-valid customer bearer token must not substitute for the internal key.
    const jwt = app.get(JwtService);
    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const customerToken = jwt.sign(
      { sub: '00000000-0000-4000-8000-000000000099', role: Role.CUSTOMER, phone: '+62' },
      { secret, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
    );
    await request(server())
      .post('/api/v1/promotions/auto-apply/apply')
      .set(auth(customerToken))
      .send(applyBody)
      .expect(401);
  });

  it('accepts an auto-apply/apply request with the correct internal key', async () => {
    await request(server())
      .post('/api/v1/promotions/auto-apply/apply')
      .set(internal(INTERNAL_KEY))
      .send(applyBody)
      .expect(204);
  });
});
