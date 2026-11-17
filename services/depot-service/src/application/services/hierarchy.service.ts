import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { Role } from '@hydromart/platform';

import { HIERARCHY_REPOSITORY, HierarchyRepository } from '../ports/hierarchy.repository';

/**
 * Resolves a multi-depot role's depots, and records the hierarchy that decides them.
 *
 * The scope walk goes DOWN the chain (see `derive`), with a visited set and a depth cap, so
 * it cannot be sent round a cycle. Cycles are also refused at write time by `setSuperior`.
 * An empty result means "sees nothing" — never "sees everything".
 */
@Injectable()
export class HierarchyService {
  constructor(@Inject(HIERARCHY_REPOSITORY) private readonly repo: HierarchyRepository) {}

  /**
   * Depots this account is responsible for: the hierarchy walk UNION any direct grants.
   *
   * Direct grants exist so a depot with no assistant supervisor yet, or a temporary
   * hand-over, can be covered without inventing a fake reporting line.
   */
  async scopedDepotIds(staffId: string, role: string): Promise<string[]> {
    const [derived, direct] = await Promise.all([
      this.derive(staffId, role),
      this.repo.directDepots(staffId),
    ]);
    return [...new Set([...derived, ...direct])];
  }

  /**
   * Everything the account's whole team holds: depots where anyone in it is the assistant
   * supervisor, plus the depots granted directly to anyone below.
   *
   * This used to be fixed levels — a manager saw exactly the depots of the assistants of
   * their supervisors. Two real shapes fell through it: a supervisor covering a depot that
   * has no assistant yet (the case direct grants exist for) gave that depot to the
   * supervisor and NOT to the manager above them, and an assistant reporting straight to a
   * manager gave the manager nothing. A manager with no placement depot then opened a
   * console where every screen was empty. Walking the team covers any chain shape.
   */
  private async derive(staffId: string, role: string): Promise<string[]> {
    // FRANCHISE_OWNER and everyone else resolve elsewhere (ownership, or unscoped); a custom
    // RESOLVED role has no place in the chain and sees its direct grants only.
    if (!HierarchyService.CHAIN_ROLES.has(role)) return [];
    const team = new Set([staffId]);
    let level = [staffId];
    for (let depth = 0; depth < HierarchyService.MAX_DEPTH && level.length > 0; depth += 1) {
      level = (await this.repo.subordinatesOfMany(level)).filter((id) => !team.has(id));
      level.forEach((id) => team.add(id));
    }
    const below = [...team].filter((id) => id !== staffId);
    const [held, granted] = await Promise.all([
      this.repo.depotsForAssistants([...team]),
      this.repo.directDepotsMany(below),
    ]);
    return [...new Set([...held, ...granted])];
  }

  private static readonly CHAIN_ROLES: ReadonlySet<string> = new Set([
    Role.ASSISTANT_SUPERVISOR,
    Role.SUPERVISOR,
    Role.MANAGER,
  ]);

  /** ponytail: deeper than any real chain (manager → spv → asisten → kepala → kurir). */
  private static readonly MAX_DEPTH = 6;

  /** The ONLY writer of a depot's assistant supervisor — deliberately not the depot PATCH,
   *  which is depotAdmin: a manager must not be able to redraw the map that decides their
   *  own scope. */
  setDepotAssistant(
    depotId: string,
    staffId: string | null,
    actorId: string | null,
  ): Promise<void> {
    return this.repo.setDepotAssistant(depotId, staffId, actorId);
  }

  /**
   * Everyone who oversees a depot: its assistant supervisor and everyone above them in the
   * reporting line. crm uses it to put supervisors and managers on the short list of alerts
   * that are theirs to know about (stock, meters, couriers), not only the staff assigned to the
   * depot. Direct depot grants are not included: the table is keyed by person, not depot.
   *
   * Bounded and cycle-safe: a loop already in the data must not hang an alert.
   */
  async overseersOfAssistant(assistantSupervisorId: string | null): Promise<string[]> {
    const chain: string[] = [];
    let cursor = assistantSupervisorId;
    while (cursor && !chain.includes(cursor) && chain.length < 8) {
      chain.push(cursor);
      cursor = await this.repo.superiorOf(cursor);
    }
    return chain;
  }

  async setSuperior(staffId: string, superiorId: string, actorId: string | null): Promise<void> {
    if (staffId === superiorId) {
      throw new BadRequestException('Seseorang tidak bisa menjadi atasan dirinya sendiri.');
    }
    // Walk UP from the proposed superior to the top: if we reach staffId, the link would
    // close a loop and the resolver would depend on its own hop bound to terminate.
    //
    // The walk is bounded by a visited Set, not by a hop count. The reporting line is no
    // longer three levels deep (kurir -> kepala depot -> asisten -> SPV -> manager ->
    // direktur), so a depth-bounded guard would wave through exactly the long chains that
    // need it most. The Set also survives a cycle that is already in the table.
    const seen = new Set<string>([staffId]);
    let cursor: string | null = superiorId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      // D-14: one column, one query. `describe()` fires four and this used a quarter of
      // the answer at every hop.
      const next = await this.repo.superiorOf(cursor);
      if (next === staffId) {
        throw new BadRequestException('Penugasan ini membentuk lingkaran atasan-bawahan.');
      }
      cursor = next;
    }
    await this.repo.setSuperior(staffId, superiorId, actorId);
  }

  clearSuperior(staffId: string): Promise<void> {
    return this.repo.clearSuperior(staffId);
  }

  grantDepot(staffId: string, depotId: string, actorId: string | null): Promise<void> {
    return this.repo.grantDepot(staffId, depotId, actorId);
  }

  revokeDepot(staffId: string, depotId: string): Promise<void> {
    return this.repo.revokeDepot(staffId, depotId);
  }

  describe(staffId: string): ReturnType<HierarchyRepository['describe']> {
    return this.repo.describe(staffId);
  }
}
