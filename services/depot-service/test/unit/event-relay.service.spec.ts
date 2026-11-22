/*
 * A DEAD event is somebody's problem, so the alert is observed, not stubbed away: the relay
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
} from '../../src/application/ports/event-outbox.repository';
import { EventRelayService } from '../../src/application/services/event-relay.service';

const NOW = new Date('2026-11-22T10:00:00.000Z');
const OCC = new Date('2026-11-22T09:59:00.000Z');

/** In-memory outbox with the same conditional writes the real table has. */
class FakeOutbox implements EventOutboxRepository {
  rows: EventOutboxRecord[] = [];
  pruned: { before: Date; limit: number }[] = [];
  /** What the application transaction does: one row per key. */
  record(eventId: string, over: Partial<EventOutboxRecord> = {}): EventOutboxRecord {
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
  async findByEventId(eventId: string): Promise<EventOutboxRecord | null> {
    return this.rows.find((r) => r.eventId === eventId) ?? null;
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
    outbox.record('franchise.application_submitted:a1');
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
    outbox.record('k1');
    await expect(svc.flush('k1')).resolves.toBeUndefined();
    expect(outbox.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'ECONNREFUSED' });
    expect(outbox.rows[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('flush sends nothing for a key it does not hold, or one already closed', async () => {
    const { outbox, transport, svc } = make();
    await svc.flush('never-recorded');
    outbox.record('done', { status: 'DONE' });
    outbox.record('dead', { status: 'DEAD' });
    await svc.flush('done');
    await svc.flush('dead');
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
    outbox.record('k1');
    await svc.flush('k1');
    // Not due yet: the backoff has not elapsed.
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ claimed: 0, ok: true });

    down = false;
    const later = new Date(Date.now() + 61 * 60_000);
    await expect(svc.processDue(later)).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      failed: 0,
      dead: 0,
      pruned: 0,
      ok: true,
    });
    expect(outbox.rows[0].status).toBe('DONE');
  });

  it('backs off 1m, 2m, 4m from the attempt that failed', async () => {
    const { outbox, svc } = make(async () => {
      throw new Error('down');
    });
    outbox.record('k1');
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

  it('gives up after six attempts: DEAD, counted, alerted, and ok=false when nothing got through', async () => {
    const { outbox, svc } = make(async () => {
      throw new Error('admin-service responded 400');
    });
    outbox.record('k1', { attempts: 5 });
    const res = await svc.processDue(new Date(Date.now() + 120 * 60_000));
    expect(res).toMatchObject({ claimed: 1, delivered: 0, failed: 1, dead: 1, ok: false });
    expect(outbox.rows[0].status).toBe('DEAD');
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'depot-webhook-outbox#dead', status: 500 }),
    );
  });

  it('a round that sends one and loses one stays ok (J7 rule)', async () => {
    let n = 0;
    const { outbox, svc } = make(async () => {
      n += 1;
      if (n === 2) throw new Error('blip');
    });
    outbox.record('k1');
    outbox.record('k2');
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ delivered: 1, failed: 1, ok: true });
  });

  it('records a thrown non-Error as its string form', async () => {
    const { outbox, svc } = make(() => Promise.reject('socket hang up'));
    outbox.record('k1');
    await svc.processDue(NOW);
    expect(outbox.rows[0].lastError).toBe('socket hang up');
  });

  it('prunes DONE rows older than a week, and a failing prune never fails the sweep', async () => {
    const { outbox, svc } = make();
    outbox.record('k1', { status: 'DONE', nextAttemptAt: new Date(Date.now() - 8 * 86_400_000) });
    const res = await svc.processDue(new Date());
    expect(res.pruned).toBe(1);
    const cutoff = outbox.pruned[0].before.getTime();
    expect(Date.now() - cutoff).toBeGreaterThan(6.9 * 86_400_000);
    expect(Date.now() - cutoff).toBeLessThan(7.1 * 86_400_000);

    outbox.pruneDone = async () => {
      throw new Error('lock timeout');
    };
    await expect(svc.processDue(new Date())).resolves.toMatchObject({ pruned: 0, ok: true });
  });

  it('uses the wall clock when the sweep is given no time', async () => {
    const { outbox, svc } = make();
    outbox.record('k1', { nextAttemptAt: new Date(Date.now() - 1000) });
    await expect(svc.processDue()).resolves.toMatchObject({ claimed: 1, delivered: 1 });
  });
});
