import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { envValidationSchema } from '../../src/config/env.validation';
import { GatewayConfigService } from '../../src/config/gateway-config.service';
import { BURST_WINDOW_MS, configureGateway } from '../../src/gateway.setup';

// B-2: express-rate-limit keys on `req.ip`. Without `trust proxy`, `req.ip` is the socket
// peer — which behind Caddy is Caddy, for every client. So the whole platform shared ONE
// counter: the configured limit stopped being "per user" and became "per deployment", and
// a single staff member opening one HQ page could lock everyone out.
//
// These tests pin the two halves of the fix that have to hold together:
//   1. distinct X-Forwarded-For clients get distinct buckets (needs `trust proxy`), and
//   2. the limit is still enforced per client (a bucket actually fills).
// Both fail before the fix — (1) because the second client inherits the first's exhausted
// counter, and there is no version of the old code where (1) passes.
//
// Note the security coupling: `trust proxy` means we now believe X-Forwarded-For, which is
// only safe because the gateway port is bound to loopback (H-19, same PR). If the port were
// reachable directly, a client could spoof this header and mint itself a fresh bucket.

function startEcho(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

/*
 * The window-edge leak, and it is arithmetic rather than taste.
 *
 * A FIXED window resets on a wall-clock boundary. A caller that spends its whole quota in the
 * last second of one window and the whole of the next in the first has sent TWICE the limit
 * inside two seconds — entirely within the rules, and exactly the shape that hurts: the
 * ceiling is a per-minute promise and the damage is per-second.
 *
 * A token bucket is the proper fix and waits on the shared store (the trigger is in
 * DEPLOY.md). A second, shorter window at the same average rate is the same defence with no
 * new dependency, and this file is the proof that it bites.
 */
const BURST = 3;

describe('burst window (fixed-window boundary spike)', () => {
  let app: INestApplication;
  let echoServer: Server;

  beforeAll(async () => {
    const echo = await startEcho();
    echoServer = echo.server;
    const testEnv: Record<string, string> = {
      NODE_ENV: 'production',
      GATEWAY_PORT: '8080',
      WEB_DOMAIN: 'hydromart-digital.com',
      AUTH_SERVICE_URL: 'http://localhost:3001',
      CUSTOMER_SERVICE_URL: 'http://localhost:3002',
      PRODUCT_SERVICE_URL: 'http://localhost:3003',
      ORDER_SERVICE_URL: echo.url,
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
      // A minute quota nowhere near spendable, so a 429 here can only be the burst window.
      RATE_LIMIT_TTL_SECONDS: '60',
      RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_OTP_MAX: '1000',
      RATE_LIMIT_BURST_MAX: String(BURST),
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
    await new Promise<void>((resolve) => echoServer.close(() => resolve()));
  });

  const get = (forwardedFor: string) =>
    request(app.getHttpServer())
      .get('/orders/api/v1/anything')
      .set('x-forwarded-for', forwardedFor);

  it('is ten seconds wide, which is what makes it a burst window and not a second minute', () => {
    expect(BURST_WINDOW_MS).toBe(10_000);
  });

  it('refuses a spike while the minute quota is nowhere near spent', async () => {
    const spiker = '203.0.113.10';
    for (let i = 0; i < BURST; i += 1) {
      await get(spiker).expect(200);
    }
    // 1000 per minute is untouched at this point, so this 429 can only be the burst window.
    await get(spiker).expect(429);
  });

  it('gives each caller its own burst bucket, so one spike is not an outage', async () => {
    for (let i = 0; i < BURST; i += 1) {
      await get('203.0.113.11').expect(200);
    }
    await get('203.0.113.11').expect(429);
    // A different caller is untouched: this is a per-caller control, not a kill switch.
    await get('203.0.113.12').expect(200);
  });
});
