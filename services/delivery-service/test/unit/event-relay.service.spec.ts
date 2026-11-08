import { EventPublisherPort } from '../../src/application/ports/event-publisher.port';
import {
  EventOutboxRecord,
  EventOutboxRepository,
} from '../../src/application/ports/event-outbox.repository';
import { EventRelayService } from '../../src/application/services/event-relay.service';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const OCC = new Date('2026-11-08T09:59:00.000Z');

/** In-memory outbox with the unique(eventId) semantics the real table has. */
class FakeOutbox implements EventOutboxRepository {
  rows: EventOutboxRecord[] = [];
  async enqueue(row: {
    event: string;
    eventId: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
  }): Promise<EventOutboxRecord | null> {
    if (this.rows.some((r) => r.eventId === row.eventId)) return null;
    const rec: EventOutboxRecord = { id: `o-${this.rows.length + 1}`, status: 'PENDING', attempts: 0, nextAttemptAt: NOW, lastError: null, ...row };
    this.rows.push(rec);
    return rec;
  }
  async findDue(now: Date, limit: number): Promise<EventOutboxRecord[]> {
    return this.rows.filter((r) => r.status === 'PENDING' && r.nextAttemptAt <= now).slice(0, limit);
  }
  async markDone(id: string): Promise<void> {
    const r = this.rows.find((x) => x.id === id && x.status === 'PENDING');
    if (r) r.status = 'DONE';
  }
  async markFailed(id: string, error: string, next: Date | null): Promise<void> {
    const r = this.rows.find((x) => x.id === id && x.status === 'PENDING');
    if (!r) return;
    r.attempts += 1;
    r.lastError = error;
    if (next) r.nextAttemptAt = next;
    else r.status = 'DEAD';
  }
}

function make(sendImpl: () => Promise<void> = async () => undefined) {
  const outbox = new FakeOutbox();
  const transport: EventPublisherPort = { publish: jest.fn(async () => sendImpl()) };
  const svc = new EventRelayService(outbox, transport);
  return { outbox, transport, svc };
}

describe('EventRelayService (AAS-11 outbox)', () => {
  it('records the event BEFORE sending, then closes it when the send lands', async () => {
    const { outbox, transport, svc } = make();
    await svc.publish('delivery.delivered', { a: 1 }, OCC, 'delivery.delivered:d1');
    expect(transport.publish).toHaveBeenCalledWith('delivery.delivered', { a: 1 }, OCC, 'delivery.delivered:d1');
    expect(outbox.rows).toMatchObject([{ eventId: 'delivery.delivered:d1', status: 'DONE' }]);
  });

  it('keeps the row PENDING with a backoff when admin-service is down, and never throws', async () => {
    const { outbox, svc } = make(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(svc.publish('e.x', {}, OCC, 'k1')).resolves.toBeUndefined();
    expect(outbox.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'ECONNREFUSED' });
    expect(outbox.rows[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('mints a key when the caller has none, so the row can still be unique', async () => {
    const { outbox, transport, svc } = make();
    await svc.publish('e.x', {}, OCC);
    expect(outbox.rows[0].eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect((transport.publish as jest.Mock).mock.calls[0][3]).toBe(outbox.rows[0].eventId);
  });

  it('a second publish of the same key is not recorded twice', async () => {
    const { outbox, svc } = make();
    await svc.publish('e.x', {}, OCC, 'same');
    await svc.publish('e.x', {}, OCC, 'same');
    expect(outbox.rows).toHaveLength(1);
  });

  it('the sweep re-sends what is due, closes it, and reports honestly', async () => {
    let down = true;
    const { outbox, svc } = make(async () => {
      if (down) throw new Error('503');
    });
    await svc.publish('e.x', {}, OCC, 'k1');
    // Not due yet: backoff has not elapsed.
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ claimed: 0, ok: true });

    down = false;
    const later = new Date(Date.now() + 61 * 60_000);
    await expect(svc.processDue(later)).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0, dead: 0, ok: true });
    expect(outbox.rows[0].status).toBe('DONE');
  });

  it('gives up after six attempts: DEAD, counted, and ok=false when nothing got through', async () => {
    const { outbox, svc } = make(async () => {
      throw new Error('503');
    });
    await svc.publish('e.x', {}, OCC, 'k1');
    outbox.rows[0].attempts = 5;
    outbox.rows[0].nextAttemptAt = NOW;
    const res = await svc.processDue(new Date(Date.now() + 120 * 60_000));
    expect(res).toMatchObject({ claimed: 1, delivered: 0, failed: 1, dead: 1, ok: false });
    expect(outbox.rows[0].status).toBe('DEAD');
  });
});
