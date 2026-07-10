import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { GatewayConfigService } from '../../src/config/gateway-config.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { configureGateway } from '../../src/gateway.setup';

// This proxy has no Prisma side-effect to auto-load .env, so seed the vars the
// validationSchema requires before ConfigModule validates process.env.
const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  GATEWAY_PORT: '8080',
  AUTH_SERVICE_URL: 'http://localhost:3001',
  CUSTOMER_SERVICE_URL: 'http://localhost:3002',
  PRODUCT_SERVICE_URL: 'http://localhost:3003',
  ORDER_SERVICE_URL: 'http://localhost:3004',
  PAYMENT_SERVICE_URL: 'http://localhost:3005',
  DELIVERY_SERVICE_URL: 'http://localhost:3006',
  DEPOT_SERVICE_URL: 'http://localhost:3007',
  DASHBOARD_SERVICE_URL: 'http://localhost:3008',
  LOYALTY_SERVICE_URL: 'http://localhost:3009',
  PROMO_SERVICE_URL: 'http://localhost:3010',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  RATE_LIMIT_TTL_SECONDS: '60',
  RATE_LIMIT_MAX: '100',
};

describe('Gateway ingress (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    Object.assign(process.env, testEnv);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true },
          load: [() => ({ ...testEnv })],
        }),
      ],
      providers: [GatewayConfigService],
    }).compile();

    app = moduleRef.createNestApplication();
    configureGateway(app, app.get(GatewayConfigService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('serves its own health check (not proxied)', async () => {
    const res = await request(server()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('gateway-service');
  });

  it('returns 404 JSON for an unknown service segment', async () => {
    const res = await request(server()).get('/nonsense/foo').expect(404);
    expect(res.body).toEqual({ statusCode: 404, message: 'Unknown service route' });
  });
});
