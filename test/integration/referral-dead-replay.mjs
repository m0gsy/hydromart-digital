// Run only against the isolated audit overlay; this writes fixture rows to its databases.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient: OrderClient } = require('../../services/order-service/prisma/generated/client');
const { PrismaClient: ReferralClient } = require('../../services/referral-service/prisma/generated/client');
const { PrismaClient: LoyaltyClient } = require('../../services/loyalty-service/prisma/generated/client');
const port = process.env.ITEST_PG_PORT ?? '15432';
const db = (name) => `postgresql://hydromart:hydromart@127.0.0.1:${port}/hydromart_${name}`;
const order = new OrderClient({ datasources: { db: { url: db('order') } } });
const referral = new ReferralClient({ datasources: { db: { url: db('referral') } } });
const loyalty = new LoyaltyClient({ datasources: { db: { url: db('loyalty') } } });
const key = 'itest-shared-internal-key-0123456789';

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `${url}: ${response.status}`);
  return response.json();
}

try {
  const referralId = randomUUID();
  const orderId = randomUUID();
  const referrer = randomUUID();
  const referee = randomUUID();
  const outboxId = randomUUID();
  await order.order.create({ data: {
    id: orderId, orderNumber: `IT-${orderId}`, customerId: referee, status: 'COMPLETED',
    subtotal: 10000, deliveryFee: 0, discount: 0, total: 10000,
    recipientName: 'Replay fixture', phone: '08000000000', addressLine: 'Fixture', city: 'Test',
    isWalkIn: true,
  } });
  await referral.referral.create({ data: {
    id: referralId, referrerCustomerId: referrer, refereeCustomerId: referee,
    code: `DEAD${referralId.slice(0, 8)}`, status: 'PENDING',
  } });
  const qualified = await post('http://127.0.0.1:13011/api/v1/referrals/qualify',
    { customerId: referee, orderId });
  assert.equal(qualified.qualified, true);
  assert.equal((await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId: referrer } })).pointsBalance, 500);

  await order.outboxMessage.create({ data: {
    id: outboxId, topic: 'REFERRAL_REVERSE', orderId, status: 'DEAD',
    attempts: 6, lastError: 'fixture receiver outage',
  } });
  assert.equal((await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId: referrer } })).pointsBalance, 500);
  assert.equal(await order.$executeRaw`
    UPDATE outbox_messages AS m SET status = 'PENDING'
    FROM orders AS o WHERE m.id = ${outboxId}::uuid AND m.status = 'DEAD'
      AND o.id = m."orderId" AND o.status = 'VOIDED'
  `, 0);
  await order.order.update({ where: { id: orderId }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: 'replay fixture' } });

  // Same one-row, status-gated replay condition documented in the operator runbook.
  const reopened = await order.$executeRaw`
    UPDATE outbox_messages AS m SET status = 'PENDING', attempts = 0,
      "nextAttemptAt" = NOW(), "updatedAt" = NOW()
    FROM orders AS o
    WHERE m.id = ${outboxId}::uuid AND m."orderId" = ${orderId}::uuid
      AND m.topic = 'REFERRAL_REVERSE' AND m.status = 'DEAD'
      AND o.id = m."orderId" AND o.status = 'VOIDED'
  `;
  assert.equal(reopened, 1);
  assert.equal(await order.$executeRaw`
    UPDATE outbox_messages SET status = 'PENDING' WHERE id = ${outboxId}::uuid AND status = 'DEAD'
  `, 0);
  const result = await post('http://127.0.0.1:13004/api/v1/orders/outbox/internal/process', {});
  assert.equal(result.delivered, 1);
  assert.equal((await order.outboxMessage.findUniqueOrThrow({ where: { id: outboxId } })).status, 'DONE');
  assert.equal((await referral.referral.findUniqueOrThrow({ where: { id: referralId } })).status, 'PENDING');
  for (const customerId of [referrer, referee]) {
    assert.equal((await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId } })).pointsBalance, 0);
  }
  assert.equal((await post('http://127.0.0.1:13004/api/v1/orders/outbox/internal/process', {})).delivered, 0);
  assert.equal((await loyalty.loyaltyAccount.findUniqueOrThrow({ where: { customerId: referrer } })).pointsBalance, 0);
  console.log('REFERRAL DEAD REPLAY PASSED: guarded one-row replay, delivered, reversed once');
} finally {
  await Promise.all([order.$disconnect(), referral.$disconnect(), loyalty.$disconnect()]);
}
