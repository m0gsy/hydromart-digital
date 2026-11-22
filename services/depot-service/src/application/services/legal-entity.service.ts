import { Inject, Injectable } from '@nestjs/common';
import { EMPLOYABLE_ROLES, currentCustomRoles, currentRoleSettings } from '@hydromart/access';
import { assertFresh, isDecisionOnlyPatch } from '@hydromart/platform';

import {
  DepotLegalEntityPointNotFoundError,
  DepotNotFoundError,
  LegalEntityInactiveError,
  LegalEntityNotFoundError,
  LegalEntityRoleNotGrantableError,
} from '../../domain/errors';
import {
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
 * 2026-11-22); nothing here changes what anybody may do in hydromart-digital.
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
    const after = await this.entities.update(id, { ...next, updatedBy: actorId });
    return { before, after, changed };
  }

  /**
   * Apply a set of matrix cells. A grant must name a role the AI web can be entered with; a
   * revoke may name anything, because taking access away is always safe (and is how a grant to a
   * since-archived custom role is cleared). One answer per cell: the last change wins.
   */
  async setAiGrants(changes: AiGrantChange[], actorId: string | null): Promise<AiGrantChange[]> {
    const byCell = new Map(changes.map((c) => [`${c.legalEntityId}|${c.roleKey}`, c]));
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
    input: { depotIds: string[]; legalEntityId: string; effectiveFrom: Date },
    actorId: string | null,
  ): Promise<AssignedDepot[]> {
    const entity = await this.get(input.legalEntityId);
    if (!entity.active) throw new LegalEntityInactiveError();
    const depotIds = [...new Set(input.depotIds)];
    const found = await this.depots.findManyByIds(depotIds, false);
    if (found.length !== depotIds.length) throw new DepotNotFoundError();
    return this.entities.assignDepots({
      depotIds,
      legalEntityId: entity.id,
      effectiveFrom: input.effectiveFrom,
      recordedBy: actorId,
    });
  }

  /** Take back one dated point (entered by mistake); the period before it then runs on. */
  async removeDepotPoint(id: string): Promise<DepotLegalEntityPoint> {
    const removed = await this.entities.removeDepotPoint(id);
    if (!removed) throw new DepotLegalEntityPointNotFoundError();
    return removed;
  }

  async get(id: string): Promise<LegalEntity> {
    const found = await this.entities.findById(id);
    if (!found) throw new LegalEntityNotFoundError();
    return found;
  }
}
