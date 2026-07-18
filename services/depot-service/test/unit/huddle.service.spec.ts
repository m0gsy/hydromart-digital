import { randomUUID } from 'node:crypto';

import { HuddleService } from '../../src/application/services/huddle.service';
import { HuddleNote } from '../../src/domain/huddle';
import { DepotNotFoundError } from '../../src/domain/errors';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import {
  HuddleRepository,
  UpsertHuddleNoteData,
} from '../../src/application/ports/huddle.repository';
import { InMemoryDepotRepository } from '../support/fakes';

const RECORDER = '11111111-1111-1111-1111-111111111111';

// Local in-memory fake — keeps this spec self-contained (does not touch test/support/fakes.ts).
class InMemoryHuddleRepository implements HuddleRepository {
  rows: HuddleNote[] = [];

  async upsert(data: UpsertHuddleNoteData): Promise<HuddleNote> {
    const now = new Date();
    const existing = this.rows.find(
      (r) => r.depotId === data.depotId && r.weekStart === data.weekStart,
    );
    if (existing) {
      existing.attendance = data.attendance;
      existing.agenda = data.agenda;
      existing.actionItems = data.actionItems;
      existing.recordedBy = data.recordedBy;
      existing.updatedAt = now;
      return existing;
    }
    const row: HuddleNote = {
      id: randomUUID(),
      depotId: data.depotId,
      weekStart: data.weekStart,
      heldAt: now,
      attendance: data.attendance,
      agenda: data.agenda,
      actionItems: data.actionItems,
      recordedBy: data.recordedBy,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async findForWeek(depotId: string, weekStart: string): Promise<HuddleNote | null> {
    return this.rows.find((r) => r.depotId === depotId && r.weekStart === weekStart) ?? null;
  }

  async listForDepot(depotId: string): Promise<HuddleNote[]> {
    return this.rows
      .filter((r) => r.depotId === depotId)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }
}

describe('HuddleService', () => {
  let repo: InMemoryHuddleRepository;
  let service: HuddleService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemoryHuddleRepository();
    service = new HuddleService(repo, depotRepo);
    const depot = await new DepotService(depotRepo).create({
      code: 'JKT-01',
      name: 'Depot Cikini',
      ownershipType: OwnershipType.HKP,
      address: 'a',
      city: 'Jakarta',
      province: 'DKI',
      lat: -6.19,
      lng: 106.84,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    });
    depotId = depot.id;
  });

  it('records a new week and reads it back', async () => {
    const note = await service.record(
      {
        depotId,
        weekStart: '2026-07-14',
        attendance: '8 dari 9 hadir',
        agenda: [{ title: 'Stok', note: 'menipis' }],
        actionItems: [{ text: 'Pesan galon', assignee: 'Budi', done: false }],
      },
      RECORDER,
    );
    expect(note.recordedBy).toBe(RECORDER);
    expect(note.agenda).toHaveLength(1);

    const week = await service.getForWeek(depotId, '2026-07-14');
    expect(week?.id).toBe(note.id);
  });

  it('upsert overwrites agenda/action items for the same week (no duplicate row)', async () => {
    await service.record(
      {
        depotId,
        weekStart: '2026-07-14',
        agenda: [{ title: 'Awal', note: 'satu' }],
        actionItems: [{ text: 'Tugas A', assignee: 'Budi', done: false }],
      },
      RECORDER,
    );
    const updated = await service.record(
      {
        depotId,
        weekStart: '2026-07-14',
        agenda: [
          { title: 'Baru 1', note: 'x' },
          { title: 'Baru 2', note: 'y' },
        ],
        actionItems: [{ text: 'Tugas B', assignee: 'Sari', done: true }],
      },
      RECORDER,
    );

    const all = await service.list(depotId);
    expect(all).toHaveLength(1); // upsert, not insert
    expect(updated.agenda.map((a) => a.title)).toEqual(['Baru 1', 'Baru 2']);
    expect(updated.actionItems).toEqual([{ text: 'Tugas B', assignee: 'Sari', done: true }]);
  });

  it('lists notes newest week first', async () => {
    await service.record({ depotId, weekStart: '2026-07-07', agenda: [], actionItems: [] }, RECORDER);
    await service.record({ depotId, weekStart: '2026-07-14', agenda: [], actionItems: [] }, RECORDER);
    const all = await service.list(depotId);
    expect(all.map((n) => n.weekStart)).toEqual(['2026-07-14', '2026-07-07']);
  });

  it('returns null for a week with no note', async () => {
    expect(await service.getForWeek(depotId, '2026-01-05')).toBeNull();
  });

  it('rejects an unknown depot', async () => {
    await expect(
      service.record(
        { depotId: randomUUID(), weekStart: '2026-07-14', agenda: [], actionItems: [] },
        RECORDER,
      ),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });
});
