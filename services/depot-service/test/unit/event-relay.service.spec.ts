/*
 * A stuck event is somebody's problem, so the alert is observed, not stubbed away: the relay
 * swallows every failure on purpose, and the property that matters is that ops is TOLD.
 */
jest.mock('@hydromart/platform', () => ({
  ...jest.requireActual('@hydromart/platform'),
  alertServerError: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const platform = require('@hydromart/platform') as { alertServerError: jest.Mock };

import { EventPublisherPort } from '../../src/application/ports/event-publisher.port';
import {
  EventOutboxRecord,
  EventOutboxRepository,
  NewOutboxEvent,
} from '../../src/application/ports/event-outbox.repository';
import { EventRelayService } from '../../src/application/services/event-relay.service';

const NOW = new Date('2026-11-22T10:00:00.000Z');
const OCC = new Date('2026-11-22T09:59:00.000Z');

/** In-memory outbox with the same conditional writes the real table has. */
class FakeOutbox implements EventOutboxRepository {
  rows: EventOutboxRecord[] = [];
  pruned: { before: Date; limit: number }[] = [];
  /** What the application transaction does: one row per key. */
  seed(eventId: string, over: Partial<EventOutboxRecord> = {}): EventOutboxRecord {
    const rec: EventOutboxRecord = {
      id: `o-${this.rows.length + 1}`,
      event: 'franchise.application_submitted',
      eventId,
      payload: { applicationId: 'a1', city: 'Depok', province: 'Jawa Barat' },
      occurredAt: OCC,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: NOW,
      lastError: null,
      ...over,
    };
    this.rows.push(rec);
    return rec;
  }
  async record(e: NewOutboxEvent): Promise<boolean> {
    if (this.rows.some((r) => r.eventId === e.eventId)) return false;
    this.seed(e.eventId, { event: e.event, payload: e.payload, occurredAt: e.occurredAt });
    return true;
  }
  async findByEventId(eventId: string): Promise<EventOutboxRecord | null> {
    return this.rows.find((r) => r.eventId === eventId) ?? null;
  }
  /** occurredAt stands in for createdAt here: the fake writes both at the same moment. */
  async countStuck(cutoff: Date): Promise<number> {
    return this.rows.filter((r) => r.status === 'PENDING' && r.occurredAt <= cutoff).length;
  }
  async findDue(now: Date, limit: number): Promise<EventOutboxRecord[]> {
    return this.rows.filter((r) => r.status === 'PENDING' && r.nextAttemptAt <= now).slice(0, limit);
  }
  async markDone(id: string): Promise<void> {
    const r = this.rows.find((x) => x.id === id && x.status === 'PENDING');
    if (r) r.status = 'DONE';
  }
  async markFailed(id: string, error: string, next: Date): Promise<void> {
    const r = this.rows.find((x) => x.id === id && x.status === 'PENDING');
    if (!r) return;
    r.attempts += 1;
    r.lastError = error;
    r.nextAttemptAt = next;
  }
  async pruneDone(before: Date, limit: number): Promise<number> {
    this.pruned.push({ before, limit });
    const gone = this.rows.filter((r) => r.status === 'DONE' && r.nextAttemptAt < before);
    this.rows = this.rows.filter((r) => !gone.includes(r));
    return gone.length;
  }
}

function make(sendImpl: () => Promise<void> = async () => undefined) {
  const outbox = new FakeOutbox();
  const transport: EventPublisherPort = { publish: jest.fn(async () => sendImpl()) };
  const svc = new EventRelayService(outbox, transport);
  return { outbox, transport, svc };
}

describe('EventRelayService (HD-7 outbox)', () => {
  const alert = platform.alertServerError;
  beforeEach(() => alert.mockClear());

  it('flush sends a recorded event and closes it', async () => {
    const { outbox, transport, svc } = make();
    outbox.seed('franchise.application_submitted:a1');
    await svc.flush('franchise.application_submitted:a1');
    expect(transport.publish).toHaveBeenCalledWith(
      'franchise.application_submitted',
      { applicationId: 'a1', city: 'Depok', province: 'Jawa Barat' },
      OCC,
      'franchise.application_submitted:a1',
    );
    expect(outbox.rows[0]).toMatchObject({ status: 'DONE', attempts: 0 });
  });

  it('flush leaves the event PENDING with a backoff when admin-service is down, and never throws', async () => {
    const { outbox, svc } = make(async () => {
      throw new Error('ECONNREFUSED');
    });
    outbox.seed('k1');
    await expect(svc.flush('k1')).resolves.toBeUndefined();
    expect(outbox.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'ECONNREFUSED' });
    expect(outbox.rows[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('flush sends nothing for a key it does not hold, or one already closed', async () => {
    const { outbox, transport, svc } = make();
    await svc.flush('never-recorded');
    outbox.seed('done', { status: 'DONE' });
    await svc.flush('done');
    expect(transport.publish).not.toHaveBeenCalled();
  });

  // The applicant's submit must not fail because the outbox read did.
  it('flush swallows a failing outbox read, leaving the row to the sweep', async () => {
    const { outbox, transport, svc } = make();
    outbox.findByEventId = async () => {
      throw new Error('connection reset');
    };
    await expect(svc.flush('k1')).resolves.toBeUndefined();
    expect(transport.publish).not.toHaveBeenCalled();
  });

  it('the sweep re-sends what is due, closes it, and reports honestly', async () => {
    let down = true;
    const { outbox, svc } = make(async () => {
      if (down) throw new Error('admin-service responded 503');
    });
    outbox.seed('k1');
    await svc.flush('k1');
    // Not due yet: the backoff has not elapsed.
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ claimed: 0, ok: true });

    down = false;
    const later = new Date(Date.now() + 61 * 60_000);
    await expect(svc.processDue(later)).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      failed: 0,
      pruned: 0,
      stuck: 0,
      ok: true,
    });
    expect(outbox.rows[0].status).toBe('DONE');
  });

  it('waits 1, 2, 4, 8, 16, 32 minutes, then an hour, between failed tries', async () => {
    const { outbox, svc } = make(async () => {
      throw new Error('down');
    });
    outbox.seed('k1');
    const waits: number[] = [];
    let at = NOW;
    for (let i = 0; i < 8; i += 1) {
      await svc.processDue(at);
      waits.push((outbox.rows[0].nextAttemptAt.getTime() - at.getTime()) / 60_000);
      at = outbox.rows[0].nextAttemptAt;
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
  });

  it('backs off 1m, 2m, 4m from the attempt that failed', async () => {
    const { outbox, svc } = make(async () => {
      throw new Error('down');
    });
    outbox.seed('k1');
    await svc.processDue(NOW);
    expect(outbox.rows[0].nextAttemptAt.getTime()).toBe(NOW.getTime() + 60_000);
    const second = new Date(NOW.getTime() + 60_000);
    await svc.processDue(second);
    expect(outbox.rows[0].nextAttemptAt.getTime()).toBe(second.getTime() + 120_000);
    const third = new Date(second.getTime() + 120_000);
    await svc.processDue(third);
    expect(outbox.rows[0]).toMatchObject({ attempts: 3 });
    expect(outbox.rows[0].nextAttemptAt.getTime()).toBe(third.getTime() + 240_000);
  });

  // A calon mitra's application must not vanish because admin-service was down for an hour.
  it('never gives an event up: past six tries it is retried an hour apart', async () => {
    const { outbox, svc } = make(async () => {
      throw new Error('admin-service responded 401');
    });
    outbox.seed('k1', { attempts: 9, occurredAt: new Date(NOW.getTime() - 30 * 86_400_000) });
    const res = await svc.processDue(NOW);
    expect(res).toMatchObject({ claimed: 1, delivered: 0, failed: 1, ok: false });
    expect(outbox.rows[0]).toMatchObject({ status: 'PENDING', attempts: 10 });
    expect(outbox.rows[0].nextAttemptAt.getTime()).toBe(NOW.getTime() + 3_600_000);
    // A thousand tries later the wait is still an hour, not Infinity.
    outbox.rows[0].attempts = 1000;
    outbox.rows[0].nextAttemptAt = NOW;
    await svc.processDue(NOW);
    expect(outbox.rows[0].nextAttemptAt.getTime()).toBe(NOW.getTime() + 3_600_000);
  });

  // Reported on every round, so /hq/health shows it beside the job; the verdict stays J7.
  it('reports how many events have been owed for an hour, without pinning the round red', async () => {
    let down = true;
    const { outbox, svc } = make(async () => {
      if (down) throw new Error('admin-service responded 503');
    });
    outbox.seed('k1', {
      occurredAt: new Date(NOW.getTime() - 3_600_000),
      nextAttemptAt: new Date(NOW.getTime() + 30 * 60_000),
    });
    // Nothing due this round: stuck is reported, ok stays the J7 verdict.
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ claimed: 0, stuck: 1, ok: true });
    // Its hourly try fails: that round is the page.
    outbox.rows[0].nextAttemptAt = NOW;
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ failed: 1, stuck: 1, ok: false });
    // Younger than an hour it is not stuck yet.
    outbox.rows[0].occurredAt = new Date(NOW.getTime() - 3_600_000 + 1);
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ stuck: 0 });

    down = false;
    outbox.rows[0].nextAttemptAt = NOW;
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ delivered: 1, stuck: 0, ok: true });
  });

  it('tells ops once, on the sixth failed try, and keeps going', async () => {
    const { outbox, svc } = make(async () => {
      throw new Error('admin-service responded 400');
    });
    outbox.seed('k1', { attempts: 4 });
    await svc.processDue(NOW); // fifth try
    expect(alert).not.toHaveBeenCalled();
    outbox.rows[0].nextAttemptAt = NOW;
    await svc.processDue(NOW); // sixth try
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'depot-webhook-outbox#stuck', status: 500 }),
    );
    expect(String(alert.mock.calls[0][0].exception.message)).toMatch(/still retrying hourly/);
    outbox.rows[0].nextAttemptAt = NOW;
    await svc.processDue(NOW); // seventh: no second alert, still owed
    expect(alert).toHaveBeenCalledTimes(1);
    expect(outbox.rows[0]).toMatchObject({ status: 'PENDING', attempts: 7 });
  });

  // flush is the only thing between an applicant and a 500 after their row is saved.
  it('flush survives a rejection that is not even an Error', async () => {
    const { outbox, svc } = make();
    outbox.findByEventId = () => Promise.reject(null);
    await expect(svc.flush('k1')).resolves.toBeUndefined();
  });

  it('a round that sends one and loses one stays ok (J7 rule)', async () => {
    let n = 0;
    const { outbox, svc } = make(async () => {
      n += 1;
      if (n === 2) throw new Error('blip');
    });
    outbox.seed('k1');
    outbox.seed('k2');
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ delivered: 1, failed: 1, ok: true });
  });

  it('records a thrown non-Error as its string form', async () => {
    const { outbox, svc } = make(() => Promise.reject('socket hang up'));
    outbox.seed('k1');
    await svc.processDue(NOW);
    expect(outbox.rows[0].lastError).toBe('socket hang up');
  });

  it('prunes DONE rows older than a week, and a failing prune never fails the sweep', async () => {
    const { outbox, svc } = make();
    outbox.seed('k1', { status: 'DONE', nextAttemptAt: new Date(Date.now() - 8 * 86_400_000) });
    const res = await svc.processDue(new Date());
    expect(res.pruned).toBe(1);
    const cutoff = outbox.pruned[0].before.getTime();
    expect(Date.now() - cutoff).toBeGreaterThan(6.9 * 86_400_000);
    expect(Date.now() - cutoff).toBeLessThan(7.1 * 86_400_000);

    outbox.pruneDone = async () => {
      throw new Error('lock timeout');
    };
    await expect(svc.processDue(new Date())).resolves.toMatchObject({ pruned: 0, ok: true });
    outbox.pruneDone = () => Promise.reject(undefined);
    await expect(svc.processDue(new Date())).resolves.toMatchObject({ pruned: 0, ok: true });
  });

  it('emit records a new event and sends it once; a repeated key is not recorded or sent again', async () => {
    const { outbox, transport, svc } = make();
    const ev = { event: 'stock.low', eventId: 'stock.low:d:i:2026-11-25', payload: { onHand: 1 }, occurredAt: OCC };
    await svc.emit(ev);
    await svc.emit(ev);
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].status).toBe('DONE');
    expect(transport.publish).toHaveBeenCalledTimes(1);
  });

  it('emit never rejects when the outbox cannot be written', async () => {
    const { outbox, svc } = make();
    outbox.record = () => Promise.reject(new Error('db down'));
    await expect(
      svc.emit({ event: 'stock.low', eventId: 'k', payload: {}, occurredAt: OCC }),
    ).resolves.toBeUndefined();
  });

  it('uses the wall clock when the sweep is given no time', async () => {
    const { outbox, svc } = make();
    outbox.seed('k1', { nextAttemptAt: new Date(Date.now() - 1000) });
    await expect(svc.processDue()).resolves.toMatchObject({ claimed: 1, delivered: 1 });
  });
});
