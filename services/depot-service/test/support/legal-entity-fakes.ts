import {
  AiGrantChange,
  AssignDepotsData,
  AssignedDepot,
  CreateLegalEntityData,
  LegalEntityRepository,
  UpdateLegalEntityData,
} from '../../src/application/ports/legal-entity.repository';
import { DepotRecord } from '../../src/application/ports/depot.repository';
import { DuplicateLegalEntityNameError } from '../../src/domain/errors';
import {
  DepotLegalEntityHistory,
  DepotLegalEntityPoint,
  LegalEntity,
  LegalEntityRecord,
  formatCalendarDay,
} from '../../src/domain/legal-entity';

/**
 * The Prisma repository's rules in memory: the name is unique ignoring case, a grant is a set
 * member, and a depot has at most one point per day (a same-day write corrects it, and writing
 * the entity it already holds there changes nothing).
 */
export class InMemoryLegalEntityRepository implements LegalEntityRepository {
  entities: LegalEntity[] = [];
  grants = new Set<string>();
  points: DepotLegalEntityPoint[] = [];
  private seq = 0;

  constructor(private readonly depots: () => DepotRecord[] = () => []) {}

  private id(prefix: string): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${prefix}${String(this.seq).padStart(12 - prefix.length, '0')}`;
  }

  private clash(name: string, exceptId?: string): boolean {
    return this.entities.some((e) => e.id !== exceptId && e.name.toLowerCase() === name.toLowerCase());
  }

  async list(): Promise<LegalEntityRecord[]> {
    return [...this.entities]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        ...e,
        aiReadRoles: [...this.grants]
          .filter((g) => g.startsWith(`${e.id}|`))
          .map((g) => g.slice(e.id.length + 1))
          .sort(),
      }));
  }

  async findById(id: string): Promise<LegalEntity | null> {
    const found = this.entities.find((e) => e.id === id);
    return found ? { ...found } : null;
  }

  async existingIds(ids: string[]): Promise<string[]> {
    return ids.filter((id) => this.entities.some((e) => e.id === id));
  }

  async create(data: CreateLegalEntityData): Promise<LegalEntity> {
    if (this.clash(data.name)) throw new DuplicateLegalEntityNameError();
    const now = new Date(Date.UTC(2026, 10, 22, 0, 0, this.seq));
    const row: LegalEntity = {
      id: this.id('e'),
      name: data.name,
      kind: data.kind,
      active: true,
      createdBy: data.createdBy,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.entities.push(row);
    return { ...row };
  }

  async update(id: string, data: UpdateLegalEntityData): Promise<LegalEntity> {
    const row = this.entities.find((e) => e.id === id)!;
    if (data.name !== undefined && this.clash(data.name, id)) throw new DuplicateLegalEntityNameError();
    Object.assign(row, data, { updatedAt: new Date(row.updatedAt.getTime() + 1000) });
    return { ...row };
  }

  async setAiGrants(changes: AiGrantChange[]): Promise<void> {
    for (const c of changes) {
      const key = `${c.legalEntityId}|${c.roleKey}`;
      if (c.granted) this.grants.add(key);
      else this.grants.delete(key);
    }
  }

  async depotHistories(): Promise<DepotLegalEntityHistory[]> {
    return [...this.depots()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((d) => ({
        depotId: d.id,
        code: d.code,
        name: d.name,
        ownershipType: d.ownershipType,
        active: d.active,
        points: this.points
          .filter((p) => p.depotId === d.id)
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
          .map((p) => ({ ...p })),
      }));
  }

  async assignDepots(data: AssignDepotsData): Promise<AssignedDepot[]> {
    const day = formatCalendarDay(data.effectiveFrom);
    const written: AssignedDepot[] = [];
    for (const depotId of data.depotIds) {
      const existing = this.points.find((p) => p.depotId === depotId && p.effectiveFrom === day);
      if (existing) {
        if (existing.legalEntityId === data.legalEntityId) continue;
        written.push({ depotId, replaced: existing.legalEntityId });
        Object.assign(existing, { legalEntityId: data.legalEntityId, recordedBy: data.recordedBy });
      } else {
        this.points.push({
          id: this.id('a'),
          depotId,
          legalEntityId: data.legalEntityId,
          effectiveFrom: day,
          recordedBy: data.recordedBy,
          recordedAt: new Date(),
        });
        written.push({ depotId, replaced: null });
      }
    }
    return written;
  }

  async removeDepotPoint(id: string): Promise<DepotLegalEntityPoint | null> {
    const found = this.points.find((p) => p.id === id);
    if (!found) return null;
    this.points = this.points.filter((p) => p.id !== id);
    return found;
  }
}
