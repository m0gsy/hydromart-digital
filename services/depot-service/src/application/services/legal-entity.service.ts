import { Inject, Injectable } from '@nestjs/common';
import { EMPLOYABLE_ROLES, currentCustomRoles, currentRoleSettings } from '@hydromart/access';
import { Role, assertFresh, isDecisionOnlyPatch } from '@hydromart/platform';

import {
  DepotLegalEntityPointNotFoundError,
  DepotNotFoundError,
  LegalEntityInactiveError,
  LegalEntityNotFoundError,
  LegalEntityRoleNotGrantableError,
} from '../../domain/errors';
import {
  DepotEntitySpan,
  DepotLegalEntityHistory,
  DepotLegalEntityPoint,
  LegalEntity,
  LegalEntityKind,
  LegalEntityRecord,
  normaliseLegalEntityName,
} from '../../domain/legal-entity';
import { DepotRepository } from '../ports/depot.repository';
import {
  AiGrantChange,
  AssignedDepot,
  LegalEntityRepository,
} from '../ports/legal-entity.repository';
import { DEPOT_TOKENS } from '../tokens';

/** A row of the AI-web matrix: a role somebody can be signed in to the AI web with. */
export interface AiGrantableRole {
  key: string;
  /** The display name a super admin gave it, or a custom role's own name; null = the built-in label. */
  name: string | null;
  custom: boolean;
}

export interface LegalEntityDirectory {
  entities: LegalEntityRecord[];
  roles: AiGrantableRole[];
}

/** What a role may read in the AI web: every entity (`all`), or exactly these. */
export interface AiGrantsOfRole {
  roleKey: string;
  all: boolean;
  legalEntityIds: string[];
}

export interface LegalEntityPatch {
  name?: string;
  kind?: LegalEntityKind;
  active?: boolean;
}

/** The fields that actually change, before and after; empty when the save changes nothing. */
export interface LegalEntityChange {
  before: LegalEntity;
  after: LegalEntity | null;
  changed: Partial<Record<keyof LegalEntityPatch, { from: unknown; to: unknown }>>;
}

/** A UUID as Postgres prints it. The DTOs accept either case; text comparisons must not care. */
const lowerId = (id: string): string => id.toLowerCase();

/**
 * The roles the AI web can be entered with. CUSTOMER never gets a handoff code, and SUPER_ADMIN
 * reads every entity whatever the matrix says, so neither is a row. Custom roles come from the
 * capability snapshot every service polls; one created seconds ago appears within 30 s.
 */
export function aiGrantableRoles(): AiGrantableRole[] {
  const renamed = new Map(
    currentRoleSettings().flatMap((s) => (s.name ? [[s.roleKey, s.name] as const] : [])),
  );
  return [
    ...EMPLOYABLE_ROLES.filter((r) => r !== 'SUPER_ADMIN').map((key) => ({
      key,
      name: renamed.get(key) ?? null,
      custom: false,
    })),
    ...currentCustomRoles().map((r) => ({ key: r.key, name: r.name, custom: true })),
  ];
}

/**
 * HD-5: legal entities, the dated record of which one each depot belongs to, and the role x
 * legal entity matrix. The matrix limits ONLY the AI web and the AI read API (owner decision
 * 2026-11-22); nothing here changes what anybody may do in hydromart-digital. It only narrows:
 * HD-6 applies a caller's own depot scope or ownership first and the matrix on top, so a grant
 * to a scoped role (a depot head, a franchise owner) never reaches beyond that role's own depots.
 */
@Injectable()
export class LegalEntityService {
  constructor(
    @Inject(DEPOT_TOKENS.LegalEntityRepository) private readonly entities: LegalEntityRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  async directory(): Promise<LegalEntityDirectory> {
    return { entities: await this.entities.list(), roles: aiGrantableRoles() };
  }

  create(input: { name: string; kind: LegalEntityKind }, actorId: string | null): Promise<LegalEntity> {
    return this.entities.create({
      name: normaliseLegalEntityName(input.name),
      kind: input.kind,
      createdBy: actorId,
    });
  }

  /**
   * Rename, re-kind or switch off. Refused when the caller's copy is older than the stored row,
   * except for a bare on/off toggle, which carries nobody's typing. A save that changes nothing
   * writes nothing, so it can neither bump the version an open form holds nor leave an audit line.
   */
  async update(
    id: string,
    patch: LegalEntityPatch,
    seenUpdatedAt: string | undefined,
    actorId: string | null,
  ): Promise<LegalEntityChange> {
    const before = await this.get(id);
    if (!isDecisionOnlyPatch(patch)) assertFresh(before.updatedAt, seenUpdatedAt);
    const next: LegalEntityPatch = {
      ...(patch.name !== undefined ? { name: normaliseLegalEntityName(patch.name) } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    };
    const changed: LegalEntityChange['changed'] = {};
    for (const key of Object.keys(next) as (keyof LegalEntityPatch)[]) {
      if (next[key] !== before[key]) changed[key] = { from: before[key], to: next[key] };
    }
    if (Object.keys(changed).length === 0) return { before, after: null, changed };
    // A bare toggle is a decision, not a copy of the record: no version to compare. A real edit
    // is compare-and-set on the version checked above.
    const after = await this.entities.update(
      id,
      { ...next, updatedBy: actorId },
      isDecisionOnlyPatch(patch) ? null : before.updatedAt,
    );
    return { before, after, changed };
  }

  /**
   * Apply a set of matrix cells. A grant must name a role the AI web can be entered with; a
   * revoke may name anything, because taking access away is always safe (and is how a grant to a
   * since-archived custom role is cleared). One answer per cell: the last change wins.
   */
  async setAiGrants(changes: AiGrantChange[], actorId: string | null): Promise<AiGrantChange[]> {
    const byCell = new Map(
      changes
        .map((c) => ({ ...c, legalEntityId: lowerId(c.legalEntityId) }))
        .map((c) => [`${c.legalEntityId}|${c.roleKey}`, c]),
    );
    const cells = [...byCell.values()];
    const grantable = new Set(aiGrantableRoles().map((r) => r.key));
    for (const c of cells) {
      if (c.granted && !grantable.has(c.roleKey)) throw new LegalEntityRoleNotGrantableError(c.roleKey);
    }
    const ids = [...new Set(cells.map((c) => c.legalEntityId))];
    if ((await this.entities.existingIds(ids)).length !== ids.length) throw new LegalEntityNotFoundError();
    await this.entities.setAiGrants(cells, actorId);
    return cells;
  }

  depotHistories(): Promise<DepotLegalEntityHistory[]> {
    return this.entities.depotHistories();
  }

  /** From `effectiveFrom`, these depots belong to this entity. Only an active entity takes new depots. */
  async assignDepots(
    input: {
      depotIds: string[];
      legalEntityId: string;
      effectiveFrom: Date;
      /** The entity the screen showed on that day, for each depot that had a point there. */
      seen: ReadonlyArray<{ id: string; legalEntityId: string }>;
    },
    actorId: string | null,
  ): Promise<AssignedDepot[]> {
    const entity = await this.get(input.legalEntityId);
    if (!entity.active) throw new LegalEntityInactiveError();
    // UUIDs are compared as text below (locks, what the screen saw): one spelling, the database's.
    const depotIds = [...new Set(input.depotIds.map(lowerId))];
    const found = await this.depots.findManyByIds(depotIds, false);
    if (found.length !== depotIds.length) throw new DepotNotFoundError();
    return this.entities.assignDepots({
      depotIds,
      legalEntityId: entity.id,
      effectiveFrom: input.effectiveFrom,
      recordedBy: actorId,
      seen: new Map(input.seen.map((s) => [lowerId(s.id), lowerId(s.legalEntityId)])),
    });
  }

  /**
   * Take back one dated point (entered by mistake); the period before it then runs on. The caller
   * names the entity its screen showed on that point: a point corrected since is not deleted blind.
   */
  async removeDepotPoint(id: string, seenLegalEntityId: string): Promise<DepotLegalEntityPoint> {
    const removed = await this.entities.removeDepotPoint(id, lowerId(seenLegalEntityId));
    if (!removed) throw new DepotLegalEntityPointNotFoundError();
    return removed;
  }

  /** HD-6: each depot's legal entity over `[from, to]`, for the AI read API's scope narrowing. */
  entityTimeline(depotIds: string[], from: Date, to: Date): Promise<DepotEntitySpan[]> {
    return this.entities.entityTimeline([...new Set(depotIds.map(lowerId))], from, to);
  }

  /** HD-6 H5: the kind of each entity named, for the AI read API's HKP / waralaba split. */
  kinds(ids: string[]): Promise<{ id: string; kind: LegalEntityKind }[]> {
    return this.entities.kindsOf([...new Set(ids.map(lowerId))]);
  }

  /**
   * HD-6: the entities a role may read in the AI web. No row = not granted, so a new entity is
   * readable by SUPER_ADMIN alone until somebody grants it; SUPER_ADMIN reads everything, entity or none.
   */
  async aiGrantsFor(roleKey: string): Promise<AiGrantsOfRole> {
    if (roleKey === Role.SUPER_ADMIN) return { roleKey, all: true, legalEntityIds: [] };
    return { roleKey, all: false, legalEntityIds: await this.entities.grantedEntityIds(roleKey) };
  }

  /**
   * HD-21: the active legal entities a role may act for in the AI web, the same grants the AI read
   * API's scope applies (HD-5 matrix): no grant = none, SUPER_ADMIN = every active entity.
   * Deliberately narrower than the read API, which also answers for an entity switched off (its
   * history is still data): the CRM may only open NEW prospects under an active entity.
   */
  async accessibleTo(roleKey: string): Promise<{ id: string; name: string }[]> {
    const grants = await this.aiGrantsFor(roleKey);
    const granted = new Set(grants.legalEntityIds.map(lowerId));
    return (await this.entities.list())
      .filter((e) => e.active && (grants.all || granted.has(lowerId(e.id))))
      .map(({ id, name }) => ({ id, name }));
  }

  /** AI-26: the role keys granted to read one entity in the AI web (SUPER_ADMIN is never a row). */
  async aiReadRolesOf(id: string): Promise<string[]> {
    // ponytail: the whole (small) entity list is read, as accessibleTo does; a per-entity query if it grows.
    const found = (await this.entities.list()).find((e) => lowerId(e.id) === lowerId(id));
    return found ? found.aiReadRoles : [];
  }

  async get(id: string): Promise<LegalEntity> {
    const found = await this.entities.findById(lowerId(id));
    if (!found) throw new LegalEntityNotFoundError();
    return found;
  }
}
