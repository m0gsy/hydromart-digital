import { OutboxService } from '../../src/application/services/outbox.service';
import { InMemoryOrderRepository, InMemoryOutboxRepository } from '../support/fakes';

// H-10, the dispatcher's own edges. The happy path and the retry/give-up ladder are
// covered end-to-end in order.service.spec; these are the two cases that only show up
// in production — a rolled-back deploy and an order that no longer exists.
describe('OutboxService edges', () => {
  let orders: InMemoryOrderRepository;
  let repo: InMemoryOutboxRepository;
  let service: OutboxService;

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    repo = new InMemoryOutboxRepository();
    orders.outbox = repo;
    service = new OutboxService(repo, orders);
  });

  // Owner decision 2026-11-21: depot-service asks this before head office changes owners.
  it('counts only franchise revenue still owed, and only for the depot asked about', async () => {
    repo.enqueue([
      { topic: 'FRANCHISE_REVENUE', orderId: 'o1' },
      { topic: 'FRANCHISE_REVENUE_VOID', orderId: 'o2' },
      { topic: 'INVENTORY_CONSUME', orderId: 'o1' },
      { topic: 'FRANCHISE_REVENUE', orderId: 'o3' },
    ]);
    repo.depotOfOrder.set('o1', 'dep-1').set('o2', 'dep-1').set('o3', 'dep-2');
    await expect(service.pendingRevenue('dep-1')).resolves.toBe(2);
    await expect(service.pendingRevenue('dep-9')).resolves.toBe(0);
  });

  // HD-6: a long depot outage must not turn the void's gallon reversal DEAD (issue left booked).
  it('gives the gallon void the same larger retry cap as a payment reversal', async () => {
    repo.enqueue([
      { topic: 'GALLON_ISSUE_VOID', orderId: 'o1' },
      { topic: 'GALLON_ISSUE', orderId: 'o2' },
    ]);
    for (const r of repo.rows) r.attempts = 7;
    const result = await service.processDue(new Date());
    expect(result).toMatchObject({ failed: 2, dead: 1 });
    expect(repo.rows.find((r) => r.topic === 'GALLON_ISSUE_VOID')!.status).toBe('PENDING');
    expect(repo.rows.find((r) => r.topic === 'GALLON_ISSUE')!.status).toBe('DEAD');
  });

  it('requeues a topic: re-arms an existing row, creates a missing one', async () => {
    repo.enqueue([{ topic: 'GALLON_ISSUE_VOID', orderId: 'o1' }]);
    repo.rows[0].status = 'DONE';
    await service.requeue('GALLON_ISSUE_VOID', 'o1');
    expect(repo.rows[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
    await service.requeue('GALLON_ISSUE_VOID', 'o2');
    expect(repo.rows).toHaveLength(2);
  });

  it('retries a topic no running version knows how to handle', async () => {
    repo.enqueue([{ topic: 'INVENTORY_CONSUME', orderId: 'ord-1' }]);

    // No handler registered: a deploy that rolled back the code but not the rows. The
    // effect is still owed, so the row stays PENDING for the version that brings it back.
    const result = await service.processDue(new Date());

    expect(result).toMatchObject({ claimed: 1, delivered: 0, failed: 1, dead: 0 });
    expect(repo.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(repo.rows[0].lastError).toContain('No handler registered');
  });

  // ORD-12: processForOrder took the oldest 50 due rows OF ALL ORDERS and filtered to this one,
  // so behind a backlog the order that just paid never got its immediate delivery.
  it('ORD-12: delivers the row of the order that just paid, behind a backlog bigger than one batch', async () => {
    const ran: string[] = [];
    service.register('INVENTORY_CONSUME', async (id) => {
      ran.push(id);
    });
    repo.enqueue(
      Array.from({ length: 80 }, (_, i) => ({ topic: 'INVENTORY_CONSUME', orderId: `old-${i}` })),
    );
    // The backlog is OLDER than the new row, so a batch of "everyone's oldest" never reaches it.
    repo.enqueue([{ topic: 'INVENTORY_CONSUME', orderId: 'ord-new' }]);
    repo.rows.find((r) => r.orderId === 'ord-new')!.nextAttemptAt = new Date(60_000);

    const result = await service.processForOrder('ord-new', '');

    // (the order is not in the fake, so the row is closed rather than handled; what matters
    // is that THIS order's row was reached and the 80 older ones were not touched)
    expect(result.claimed).toBe(1);
    expect(result.delivered).toBe(1);
    expect(ran).toEqual([]);
    expect(repo.rows.find((r) => r.orderId === 'ord-new')?.status).toBe('DONE');
    expect(repo.rows.filter((r) => r.status === 'PENDING')).toHaveLength(80);
  });

  it('closes a row whose order no longer exists instead of retrying it to death', async () => {
    const ran: string[] = [];
    service.register('INVENTORY_CONSUME', async (id) => {
      ran.push(id);
    });
    repo.enqueue([{ topic: 'INVENTORY_CONSUME', orderId: 'gone' }]);

    const result = await service.processDue(new Date());

    expect(result.delivered).toBe(1);
    expect(ran).toEqual([]);
    expect(repo.rows[0].status).toBe('DONE');
  });

  it('sweeps on the server clock when ops trigger it with no arguments', async () => {
    service.register('LOYALTY_AWARD', async () => undefined);
    repo.enqueue([{ topic: 'LOYALTY_AWARD', orderId: 'ord-1' }]);
    orders.rows.push({ id: 'ord-1' } as never);

    await expect(service.processDue()).resolves.toMatchObject({ delivered: 1 });
  });

  it('reports an empty sweep without logging a summary nobody needs', async () => {
    await expect(service.processDue(new Date())).resolves.toEqual({
      claimed: 0,
      delivered: 0,
      failed: 0,
      dead: 0,
      ok: true,
    });
  });

  it('records a non-Error rejection and reports what is still owed', async () => {
    service.register('LOYALTY_AWARD', async () => {
      // Adapters throw strings often enough that a String() coercion is not theoretical.
      throw 'loyalty-service unreachable';
    });
    repo.enqueue([{ topic: 'LOYALTY_AWARD', orderId: 'ord-1' }]);
    orders.rows.push({ id: 'ord-1' } as never);

    await service.processDue(new Date());

    expect(repo.rows[0].lastError).toBe('loyalty-service unreachable');
    await expect(service.pending()).resolves.toEqual({ PENDING: 1, DONE: 0, DEAD: 0, CANCELLED: 0 });
  });
});
