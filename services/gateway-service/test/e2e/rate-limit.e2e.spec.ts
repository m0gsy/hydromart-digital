import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { envValidationSchema } from '../../src/config/env.validation';
import { GatewayConfigService } from '../../src/config/gateway-config.service';
import { configureGateway } from '../../src/gateway.setup';

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

const LIMIT = 3;

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

describe('Gateway rate limit is per client, not per deployment (e2e)', () => {
  let app: INestApplication;
  let echo: { server: Server; url: string };

  beforeAll(async () => {
    echo = await startEcho();
    const testEnv: Record<string, string> = {
      NODE_ENV: 'test',
      GATEWAY_PORT: '8080',
      // This suite asserts the behaviour of a gateway BEHIND a proxy, so it has to say so
      // now: trusting an X-Forwarded-For hop is conditional on one actually existing.
      // Without a proxy the correct answer is to trust nothing, which is what a bare-IP
      // box gets and what it should always have had.
      WEB_DOMAIN: 'hydromart-digital.test',
      PUBLIC_BIND: '127.0.0.1',
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
      RATE_LIMIT_TTL_SECONDS: '60',
      RATE_LIMIT_MAX: String(LIMIT),
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

  const get = (forwardedFor: string) =>
    request(app.getHttpServer())
      .get('/orders/api/v1/anything')
      .set('x-forwarded-for', forwardedFor);

  it('trusts one proxy hop, so req.ip is the client and not the proxy', () => {
    const instance = app.getHttpAdapter().getInstance();
    expect(instance.get('trust proxy')).toBe(1);
  });

  it('does not spend one client’s budget on another client', async () => {
    // Exhaust the first client's bucket completely.
    for (let i = 0; i < LIMIT; i += 1) {
      await get('203.0.113.10').expect(200);
    }
    await get('203.0.113.10').expect(429);

    // A different client must still be served. Before the fix both collapse into the
    // socket-peer bucket, so this is a 429 — one user locking out everyone else.
    await get('203.0.113.99').expect(200);
  });

  it('still enforces the limit within a single client', async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      await get('198.51.100.7').expect(200);
    }
    await get('198.51.100.7').expect(429);
  });

  // J5: `trust proxy` only splits buckets by ADDRESS. Eight couriers behind one depot
  // router or one 4G hotspot still share one address — and the offline queue flushes
  // them all in the same instant when signal returns. These two pin that an identified
  // caller is charged to themselves, on both transports, since the limiter runs ahead
  // of the cookie -> bearer translation and so has to read each one itself.
  it('gives two bearer clients behind ONE address their own budgets', async () => {
    const nat = '192.0.2.50';
    const asUser = (token: string) => get(nat).set('authorization', `Bearer ${token}`);

    for (let i = 0; i < LIMIT; i += 1) {
      await asUser('courier-a').expect(200);
    }
    await asUser('courier-a').expect(429);

    await asUser('courier-b').expect(200);
  });

  it('reads the session cookie as an identity too, not just the header', async () => {
    const office = '192.0.2.51';
    const asUser = (at: string) => get(office).set('cookie', `hm_at=${at}`);

    for (let i = 0; i < LIMIT; i += 1) {
      await asUser('staff-a').expect(200);
    }
    await asUser('staff-a').expect(429);

    await asUser('staff-b').expect(200);
  });

  it('still falls back to the address when the caller is anonymous', async () => {
    // Login and catalogue browsing carry no credential; an unauthenticated flood has
    // no identity to charge, so the IP bucket is the right — and only — answer there.
    for (let i = 0; i < LIMIT; i += 1) {
      await get('192.0.2.77').expect(200);
    }
    await get('192.0.2.77').expect(429);
  });
});
