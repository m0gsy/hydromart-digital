// Run only against the isolated test overlay; all rows created here are fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient: ReferralClient } = require('../../services/referral-service/prisma/generated/client');
const { PrismaClient: LoyaltyClient } = require('../../services/loyalty-service/prisma/generated/client');
const port = process.env.ITEST_PG_PORT ?? '15432';
const referral = new ReferralClient({ datasources: { db: { url: `postgresql://hydromart:hydromart@127.0.0.1:${port}/hydromart_referral` } } });
const loyalty = new LoyaltyClient({ datasources: { db: { url: `postgresql://hydromart:hydromart@127.0.0.1:${port}/hydromart_loyalty` } } });
const base = process.env.ITEST_REFERRAL_URL ?? 'http://127.0.0.1:13011';
const key = 'itest-shared-internal-key-0123456789';

async function call(path, customerId, orderId) {
  const response = await fetch(`${base}/api/v1/referrals/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify({ customerId, orderId }),
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const referralId = randomUUID();
  const referrer = randomUUID();
  const referee = randomUUID();
  const oldOrder = randomUUID();
  const nextOrder = randomUUID();
  await referral.referral.create({ data: {
    id: referralId, referrerCustomerId: referrer, refereeCustomerId: referee,
    code: 'VOIDTEST', status: 'PENDING',
  } });

  assert.equal((await call('qualify', referee, oldOrder)).body.qualified, true);
  const referrerAccount = await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId: referrer } });
  assert.equal(referrerAccount.pointsBalance, 500);
  assert.equal((await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId: referee } })).pointsBalance, 250);

  // Spend 400 points in the test DB to verify the shortage is recorded and no negative balance appears.
  await loyalty.$transaction([
    loyalty.pointsTransaction.create({ data: {
      accountId: referrerAccount.id, customerId: referrer, type: 'REDEEM', points: -400,
      reason: 'isolated fixture spend',
    } }),
    loyalty.loyaltyAccount.update({ where: { id: referrerAccount.id }, data: { pointsBalance: { decrement: 400 } } }),
  ]);
  const deferred = await call('qualify', referee, nextOrder);
  assert.ok(deferred.status >= 500, `expected retryable error, got ${deferred.status}`);

  assert.equal((await call('internal/void-qualification', referee, oldOrder)).body.reversed, true);
  const reopened = await referral.referral.findUniqueOrThrow({ where: { id: referralId } });
  assert.equal(reopened.status, 'PENDING');
  assert.equal(reopened.qualifyingOrderId, null);
  assert.equal((await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId: referrer } })).pointsBalance, 0);
  const reversal = await loyalty.pointsTransaction.findUniqueOrThrow({
    where: { customerId_idempotencyKey: { customerId: referrer, idempotencyKey: `void:referral:${referralId}:${oldOrder}:referrer` } },
  });
  assert.equal(reversal.points, -100);
  assert.equal(reversal.uncollectedPoints, 400);
  assert.equal((await call('qualify', referee, oldOrder)).body.qualified, false);
  const late = await fetch('http://127.0.0.1:13009/api/v1/loyalty/reward', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify({ customerId: referrer, points: 500, reason: 'late referral',
      idempotencyKey: `referral:${referralId}:${oldOrder}:referrer` }),
  });
  assert.equal(late.status, 201);
  assert.equal((await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId: referrer } })).pointsBalance, 0);
  assert.equal((await call('qualify', referee, nextOrder)).body.qualified, true);
  assert.equal((await call('qualify', referee, nextOrder)).body.qualified, false);
  assert.equal((await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId: referrer } })).pointsBalance, 500);
  assert.equal((await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId: referee } })).pointsBalance, 250);
  console.log('REFERRAL VOID INTEGRATION PASSED: reverse, shortfall, tombstone, requalify, idempotency');
}

try {
  await main();
} finally {
  await Promise.all([referral.$disconnect(), loyalty.$disconnect()]);
}
