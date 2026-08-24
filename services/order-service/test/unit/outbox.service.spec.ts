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

  it('retries a topic no running version knows how to handle', async () => {
    repo.enqueue([{ topic: 'INVENTORY_CONSUME', orderId: 'ord-1' }]);

    // No handler registered: a deploy that rolled back the code but not the rows. The
    // effect is still owed, so the row stays PENDING for the version that brings it back.
    const result = await service.processDue(new Date());

    expect(result).toMatchObject({ claimed: 1, delivered: 0, failed: 1, dead: 0 });
    expect(repo.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(repo.rows[0].lastError).toContain('No handler registered');
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
