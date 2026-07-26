import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { GatewayConfigService } from '../../src/config/gateway-config.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { configureGateway } from '../../src/gateway.setup';
import { AT_COOKIE } from '../../src/routing/session-bff';

// Echo upstream reflecting the Authorization header the gateway forwarded, so the
// test can assert the httpOnly access cookie was translated into a bearer header.
function startEcho(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ auth: req.headers['authorization'] ?? null }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe('Gateway cookie -> bearer translation', () => {
  let app: INestApplication;
  let echo: { server: Server; url: string };

  beforeAll(async () => {
    echo = await startEcho();
    const testEnv: Record<string, string> = {
      NODE_ENV: 'test',
      GATEWAY_PORT: '8080',
      AUTH_SERVICE_URL: 'http://localhost:3001',
      CUSTOMER_SERVICE_URL: 'http://localhost:3002',
      PRODUCT_SERVICE_URL: 'http://localhost:3003',
      ORDER_SERVICE_URL: echo.url, // route /orders/* at the echo upstream
      PAYMENT_SERVICE_URL: 'http://localhost:3005',
      DELIVERY_SERVICE_URL: 'http://localhost:3006',
      DEPOT_SERVICE_URL: 'http://localhost:3007',
      DASHBOARD_SERVICE_URL: 'http://localhost:3008',
      LOYALTY_SERVICE_URL: 'http://localhost:3009',
      PROMO_SERVICE_URL: 'http://localhost:3010',
      REFERRAL_SERVICE_URL: 'http://localhost:3011',
      CRM_SERVICE_URL: 'http://localhost:3012',
      RECOMMENDATION_SERVICE_URL: 'http://localhost:3013',
      FORECAST_SERVICE_URL: 'http://localhost:3014',
      PAYOUT_SERVICE_URL: 'http://localhost:3016',
      ADMIN_SERVICE_URL: 'http://localhost:3017',
      HR_SERVICE_URL: 'http://localhost:3018',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
      RATE_LIMIT_TTL_SECONDS: '60',
      RATE_LIMIT_MAX: '100',
    };
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
    await new Promise<void>((resolve) => echo.server.close(() => resolve()));
  });

  it('injects an Authorization: Bearer header from the access cookie', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders/api/v1/anything')
      .set('Cookie', `${AT_COOKIE}=AT-9`)
      .expect(200);

    expect(res.body.auth).toBe('Bearer AT-9');
  });

  it('leaves an explicit Authorization header untouched (no cookie override)', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders/api/v1/anything')
      .set('Cookie', `${AT_COOKIE}=AT-9`)
      .set('Authorization', 'Bearer explicit')
      .expect(200);

    expect(res.body.auth).toBe('Bearer explicit');
  });
});
