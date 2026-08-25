import { createHmac } from 'node:crypto';

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

// L3-SEC-1: the identity the gateway will accept is one signed with THIS secret. The suite
// signs its own tokens with it, so "an issued token" and "an invented string" are two
// genuinely different inputs here rather than two spellings of the same thing.
const JWT_ACCESS_SECRET = 'e2e-gateway-access-secret-long-enough-0123456789';

const LIMIT = 3;
// Deliberately BELOW the general limit: the OTP tier has to bite first, or it is not a
// tier at all — it is a second copy of the number it sits underneath.
const OTP_LIMIT = 2;

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
      JWT_ACCESS_SECRET,
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
      RATE_LIMIT_OTP_MAX: String(OTP_LIMIT),
      // With a token bucket the thing that refuses a BURST is the capacity, and
      // RATE_LIMIT_MAX only sets how fast it refills. Both are LIMIT here so the refill over
      // the few milliseconds these requests take is negligible, and the assertions below
      // stay about IDENTITY — which is what this file is for.
      RATE_LIMIT_BURST_MAX: String(LIMIT),
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

  /*
   * J5 + L3-SEC-1, and the second is why these two changed.
   *
   * `trust proxy` only splits buckets by ADDRESS. Eight couriers behind one depot router or
   * one 4G hotspot still share one address, and the offline queue flushes them all in the
   * same instant when signal returns — so an identified caller must be charged to
   * themselves, on both transports, since the limiter runs ahead of the cookie -> bearer
   * translation and has to read each one itself.
   *
   * These tests used to prove that with the literal identities `courier-a` and `courier-b`
   * — two strings nobody signed. That passed, and it was the bypass written down as a
   * specification: if an arbitrary string is an identity, then an address whose budget is
   * spent buys a new one by making one up. Measured against the running gateway before the
   * fix: 0 of 60 requests passed with no header, 28 of 60 with a junk bearer rotated per
   * request, same address.
   *
   * So the identity is now a token signed with the same secret the app boots with, and the
   * third test below is the regression: invented ones must NOT escape the address bucket.
   */
  const signed = (sub: string) => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
    const sig = createHmac('sha256', JWT_ACCESS_SECRET)
      .update(`${head}.${body}`)
      .digest('base64url');
    return `${head}.${body}.${sig}`;
  };

  it('gives two verified bearer clients behind ONE address their own budgets', async () => {
    const nat = '192.0.2.50';
    const asUser = (sub: string) => get(nat).set('authorization', `Bearer ${signed(sub)}`);

    for (let i = 0; i < LIMIT; i += 1) {
      await asUser('courier-a').expect(200);
    }
    await asUser('courier-a').expect(429);

    await asUser('courier-b').expect(200);
  });

  it('reads the session cookie as an identity too, not just the header', async () => {
    const office = '192.0.2.51';
    const asUser = (sub: string) => get(office).set('cookie', `hm_at=${signed(sub)}`);

    for (let i = 0; i < LIMIT; i += 1) {
      await asUser('staff-a').expect(200);
    }
    await asUser('staff-a').expect(429);

    await asUser('staff-b').expect(200);
  });

  it('does NOT let an invented bearer escape the address bucket (L3-SEC-1)', async () => {
    // The reported bypass, as a test. One address, a different unsigned token every
    // request: every one of them must be charged to the address, so the ceiling still
    // arrives. Before the fix each rotation minted a private bucket and this never 429'd.
    const attacker = '192.0.2.99';
    for (let i = 0; i < LIMIT; i += 1) {
      await get(attacker).set('authorization', `Bearer invented-${i}`).expect(200);
    }
    await get(attacker).set('authorization', 'Bearer invented-final').expect(429);
    // And with no header at all, from the same spent address.
    await get(attacker).expect(429);
  });

  it('still falls back to the address when the caller is anonymous', async () => {
    // Login and catalogue browsing carry no credential; an unauthenticated flood has
    // no identity to charge, so the IP bucket is the right — and only — answer there.
    for (let i = 0; i < LIMIT; i += 1) {
      await get('192.0.2.77').expect(200);
    }
    await get('192.0.2.77').expect(429);
  });

  /*
   * The OTP tier is a BILLING control. auth-service caps resends per customer, but nothing
   * capped a caller walking a DIFFERENT phone number on every request — one IP, one script,
   * and every request past it is a paid SMS to a stranger's handset.
   */
  const postOtp = (forwardedFor: string, path: string) =>
    request(app.getHttpServer()).post(path).set('x-forwarded-for', forwardedFor).send({});

  it.each(['/auth/api/v1/auth/register', '/auth/api/v1/auth/login', '/auth/api/v1/auth/otp/resend'])(
    'stops an SMS pump at %s well before the general limit',
    async (path) => {
      const ip = `198.51.100.${path.length}`;
      for (let i = 0; i < OTP_LIMIT; i += 1) {
        const res = await postOtp(ip, path);
        expect(res.status).not.toBe(429);
      }
      await postOtp(ip, path).expect(429);
    },
  );

  it('charges the OTP bucket by ADDRESS, so one script cannot walk numbers from one host', async () => {
    const attacker = '198.51.100.200';
    for (let i = 0; i < OTP_LIMIT; i += 1) {
      // A different phone every time is exactly the shape that costs money, and it must
      // not buy a fresh bucket.
      await request(app.getHttpServer())
        .post('/auth/api/v1/auth/register')
        .set('x-forwarded-for', attacker)
        .send({ phone: `+62811000000${i}` });
    }
    await postOtp(attacker, '/auth/api/v1/auth/register').expect(429);
    // A different client is untouched: this is a per-caller control, not an outage switch.
    await postOtp('198.51.100.201', '/auth/api/v1/auth/register').expect((res) =>
      expect(res.status).not.toBe(429),
    );
  });

  it('leaves verify alone — it sends no SMS, and auth-service already caps its guesses', async () => {
    const ip = '198.51.100.250';
    for (let i = 0; i < OTP_LIMIT + 1; i += 1) {
      const res = await postOtp(ip, '/auth/api/v1/auth/otp/verify');
      expect(res.status).not.toBe(429);
    }
  });

});
