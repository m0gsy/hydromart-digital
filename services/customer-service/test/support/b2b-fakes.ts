import { randomUUID } from 'node:crypto';

import {
  B2bProspectRepository,
  CoverageRaw,
  CreateOutcome,
  DncKeys,
  ProspectListQuery,
  ProspectPatch,
  VisitRecord,
} from '../../src/application/ports/b2b-prospect.repository';
import { DuplicateProbe, NewProspect, ProspectRecord } from '../../src/domain/b2b-prospect';
import { matchDuplicate } from '../../src/domain/b2b-prospect-keys';

/** In-memory twin of the Prisma repository: same rules, no database. */
export class InMemoryProspectRepository implements B2bProspectRepository {
  rows = new Map<string, ProspectRecord>();
  dnc = new Set<string>();
  batches: Record<string, unknown>[] = [];
  visitRows: VisitRecord[] = [];
  private tick = 0;

  private stamp(): Date {
    return new Date(1_800_000_000_000 + (this.tick += 1) * 1000);
  }

  async findById(id: string): Promise<ProspectRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async list(q: ProspectListQuery): Promise<{ items: ProspectRecord[]; nextCursor: string | null }> {
    const all = [...this.rows.values()]
      .filter((r) => (q.scope === 'map' ? r.ownerDepotId === null : r.ownerDepotId !== null && (!q.depotIds || q.depotIds.includes(r.ownerDepotId))))
      .filter((r) => !q.status || r.status === q.status)
      .filter((r) => !q.category || r.category === q.category)
      .filter((r) => !q.kecamatanCode || r.kecamatanCode === q.kecamatanCode)
      .filter((r) => !q.kelurahanCode || r.kelurahanCode === q.kelurahanCode)
      .filter((r) => !q.assignedToId || r.assignedToId === q.assignedToId)
      .filter((r) => !q.unassigned || r.assignedToId === null)
      .filter((r) => !q.q || r.name.toLowerCase().includes(q.q.toLowerCase()))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = q.cursor ? all.findIndex((r) => r.id === q.cursor) : 0;
    const page = all.slice(start, start + q.limit + 1);
    return { items: page.slice(0, q.limit), nextCursor: page[q.limit]?.id ?? null };
  }

  async visits(): Promise<VisitRecord[]> {
    return this.visitRows;
  }

  async findDuplicateCandidates(probe: DuplicateProbe): Promise<DuplicateProbe[]> {
    return [...this.rows.values()].filter((r) => matchDuplicate([r], probe) !== null);
  }

  async dncPresent(keys: DncKeys): Promise<boolean> {
    return (
      (keys.phoneHash !== null && this.dnc.has(`PHONE:${keys.phoneHash}`)) ||
      keys.placeHashes.some((h) => this.dnc.has(`PLACE:${h}`))
    );
  }

  async createGuarded(data: NewProspect, dnc: DncKeys): Promise<CreateOutcome> {
    if (await this.dncPresent(dnc)) return { ok: false, reason: 'DO_NOT_CONTACT' };
    const probe: DuplicateProbe = { ...data };
    if (matchDuplicate(await this.findDuplicateCandidates(probe), probe)) return { ok: false, reason: 'DUPLICATE' };
    const now = this.stamp();
    const prospect: ProspectRecord = {
      ...data,
      id: randomUUID(),
      ownerSource: 'AUTO',
      status: 'NEW',
      assignedToId: null,
      assignedAt: null,
      customerId: null,
      convertedAt: null,
      lostReason: null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(prospect.id, prospect);
    return { ok: true, prospect };
  }

  async update(id: string, patch: ProspectPatch, seenUpdatedAt?: Date): Promise<ProspectRecord | null> {
    const row = this.rows.get(id);
    if (!row || (seenUpdatedAt && row.updatedAt.getTime() !== seenUpdatedAt.getTime())) return null;
    const next = { ...row, ...patch, updatedAt: this.stamp() } as ProspectRecord;
    this.rows.set(id, next);
    return next;
  }

  async addDnc(entries: { kind: 'PHONE' | 'PLACE'; keyHash: string }[]): Promise<void> {
    for (const e of entries) this.dnc.add(`${e.kind}:${e.keyHash}`);
  }

  async suppress(
    match: { id?: string; phoneE164?: string | null; nameKey?: string; cells?: readonly string[] },
    entries: { kind: 'PHONE' | 'PLACE'; keyHash: string }[],
    _reason: string,
    _by: string,
    now: Date,
  ): Promise<number> {
    await this.addDnc(entries);
    let n = 0;
    for (const r of this.rows.values()) {
      const hit =
        r.id === match.id ||
        (!!match.phoneE164 && r.phoneE164 === match.phoneE164) ||
        (!!match.nameKey && r.nameKey === match.nameKey && !!match.cells?.includes(r.gridCell));
      if (!hit || r.status === 'CONVERTED' || r.status === 'DO_NOT_CONTACT') continue;
      Object.assign(r, {
        status: 'DO_NOT_CONTACT',
        phoneE164: null,
        contactName: null,
        note: null,
        address: null,
        lostReason: null,
        assignedToId: null,
        assignedAt: null,
        lastActivityAt: now,
      });
      n += 1;
    }
    return n;
  }

  async createBatch(data: Record<string, unknown> & { id: string }): Promise<void> {
    this.batches.push(data);
  }

  async coverage(): Promise<CoverageRaw> {
    throw new Error('coverage is exercised against a stub in the service spec');
  }
}

/** A prospect row with sensible defaults, for service specs that seed the fake directly. */
export function prospect(over: Partial<ProspectRecord> = {}): ProspectRecord {
  const now = new Date('2026-11-27T03:00:00.000Z');
  return {
    id: randomUUID(),
    name: 'Kos Melati',
    nameKey: 'kosmelati',
    category: 'KOS',
    phoneE164: '+6281200000001',
    contactName: 'Bu Sari',
    address: 'Jl. Melati 1',
    latitude: -6.2,
    longitude: 106.8,
    gridCell: '-689:11866',
    kecamatanCode: null,
    kelurahanCode: null,
    ownerDepotId: 'depot-a',
    ownerSource: 'AUTO',
    status: 'NEW',
    assignedToId: null,
    assignedAt: null,
    source: 'OSM',
    licence: 'ODbL-1.0',
    sourceId: null,
    sourceDataset: null,
    sourceDate: null,
    batchId: null,
    customerId: null,
    convertedAt: null,
    lostReason: null,
    note: 'catatan',
    lastActivityAt: now,
    createdById: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}
