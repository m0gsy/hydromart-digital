import { randomUUID } from 'node:crypto';

import { PaymentService } from '../../src/application/services/payment.service';
import { PaymentMethod, PaymentStatus, RefundApproval } from '../../src/domain/payment';
import { PaymentPrismaRepository } from '../../src/infrastructure/prisma/payment.prisma.repository';
import { FakeGateway, FakeOrderCoordination, buildTestConfig } from '../support/fakes';
import { describeRace, freshPrisma, race } from './db';

describeRace('PaymentService on real Postgres — concurrent transitions', () => {
  let drop: () => Promise<void>;
  let repo: PaymentPrismaRepository;
  let gateway: FakeGateway;
  let orders: FakeOrderCoordination;
  let service: PaymentService;
  const customer = randomUUID();

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    repo = new PaymentPrismaRepository(db.prisma as never);
  });
  afterAll(async () => drop?.());

  beforeEach(() => {
    gateway = new FakeGateway();
    orders = new FakeOrderCoordination();
    service = new PaymentService(repo, gateway, orders, buildTestConfig());
  });

  const open = (method: PaymentMethod, amount = 45_000) =>
    service.initiate(customer, { orderId: randomUUID(), method, amount });

  it('a cash confirmation racing a cancel never leaves PAID money on a cancelled order', async () => {
    for (let i = 0; i < 25; i++) {
      const payment = await open(PaymentMethod.CASH);
      const [, cancel] = await race([
        () => service.confirm(payment.id, 'kasir', 50_000),
        () => service.cancelForOrder(payment.orderId, 'Dibatalkan', 'order-service'),
      ]);

      const final = (await repo.findById(payment.id))!;
      // Either the cancel won (FAILED, confirm refused) or the confirm won and the cancel
      // refunded it. PAID after a completed cancel is the bug this fix exists for.
      expect([PaymentStatus.FAILED, PaymentStatus.REFUNDED]).toContain(final.status);
      expect(cancel.status).toBe('fulfilled');
    }
  });

  it('ten concurrent identical confirmations book the cash once', async () => {
    const payment = await open(PaymentMethod.CASH);

    const results = await race(
      Array.from({ length: 10 }, () => () => service.confirm(payment.id, 'kurir', 50_000)),
    );

    expect((await repo.findById(payment.id))!.status).toBe(PaymentStatus.PAID);
    // Every caller is answered with the paid payment (winner or replay); none is a conflict.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    // Only the winner confirms the order.
    expect(orders.confirmedOrderIds).toEqual([payment.orderId]);
  });

  it('a confirm racing a staff rejection has exactly one winner', async () => {
    for (let i = 0; i < 15; i++) {
      const payment = await open(PaymentMethod.TRANSFER);
      const [confirm, fail] = await race([
        () => service.confirm(payment.id, 'staff'),
        () => service.fail(payment.id, 'staff'),
      ]);

      const final = (await repo.findById(payment.id))!;
      expect([confirm.status, fail.status].sort()).toEqual(['fulfilled', 'rejected']);
      expect(final.status).toBe(confirm.status === 'fulfilled' ? 'PAID' : 'FAILED');
      // The rejection notice only exists if the rejection actually landed.
      expect(orders.notices.some((n) => n.orderId === payment.orderId)).toBe(
        fail.status === 'fulfilled',
      );
    }
  });

  describe('refund queue', () => {
    const queued = async () => {
      const payment = await open(PaymentMethod.VA, 150_000);
      await service.confirm(payment.id, 'staff');
      await service.refund(payment.id, 'finance', 'pesanan salah');
      orders.orderStatuses.set(payment.orderId, 'DELIVERED');
      return payment;
    };

    it('approve racing reject: the customer is refunded at most once and the row never contradicts the money', async () => {
      for (let i = 0; i < 10; i++) {
        gateway.refunds.length = 0;
        const payment = await queued();
        const [approve, reject] = await race([
          () => service.approveRefund(payment.id, 'hq'),
          () => service.rejectRefund(payment.id, 'hq', 'tidak valid'),
        ]);

        const final = (await repo.findById(payment.id))!;
        expect([approve.status, reject.status].sort()).toEqual(['fulfilled', 'rejected']);
        if (approve.status === 'fulfilled') {
          expect(final.status).toBe(PaymentStatus.REFUNDED);
          expect(final.refundApproval).toBe(RefundApproval.APPROVED);
          expect(gateway.refunds).toHaveLength(1);
        } else {
          expect(final.status).toBe(PaymentStatus.PAID);
          expect(final.refundApproval).toBe(RefundApproval.REJECTED);
          expect(gateway.refunds).toHaveLength(0);
        }
      }
    });

    it('two concurrent approvals pay the customer once', async () => {
      const payment = await queued();

      const results = await race([
        () => service.approveRefund(payment.id, 'hq-1'),
        () => service.approveRefund(payment.id, 'hq-2'),
        () => service.approveRefund(payment.id, 'hq-3'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(gateway.refunds).toHaveLength(1);
    });
  });
});
