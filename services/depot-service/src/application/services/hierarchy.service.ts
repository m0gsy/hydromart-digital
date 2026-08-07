import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { Role } from '@hydromart/platform';

import { HIERARCHY_REPOSITORY, HierarchyRepository } from '../ports/hierarchy.repository';

/**
 * Resolves a multi-depot role's depots, and records the hierarchy that decides them.
 *
 * The scope walk is DOWN the chain and written as explicit levels (see `derive`), so it
 * cannot be sent round a cycle at all. Cycles are refused at write time by `setSuperior`.
 * An empty result means "sees nothing" — never "sees everything".
 */
@Injectable()
export class HierarchyService {
  constructor(
    @Inject(HIERARCHY_REPOSITORY) private readonly repo: HierarchyRepository,
  ) {}

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
   * The walk, written as explicit levels rather than a loop: each role sits at a known
   * distance from the depots, so spelling it out is both clearer and impossible to send
   * round a cycle. Depots only ever hang off an ASSISTANT_SUPERVISOR.
   */
  private async derive(staffId: string, role: string): Promise<string[]> {
    if (role === Role.ASSISTANT_SUPERVISOR) {
      return this.repo.depotsForAssistant(staffId);
    }
    if (role === Role.SUPERVISOR) {
      const assistants = await this.repo.subordinatesOf(staffId);
      return this.repo.depotsForAssistants(assistants);
    }
    if (role === Role.MANAGER) {
      const supervisors = await this.repo.subordinatesOf(staffId);
      const assistants = await this.repo.subordinatesOfMany(supervisors);
      return this.repo.depotsForAssistants(assistants);
    }
    // FRANCHISE_OWNER and everyone else resolve elsewhere (ownership, or unscoped).
    return [];
  }

  /** The ONLY writer of a depot's assistant supervisor — deliberately not the depot PATCH,
   *  which is depotAdmin: a manager must not be able to redraw the map that decides their
   *  own scope. */
  setDepotAssistant(depotId: string, staffId: string | null, actorId: string | null): Promise<void> {
    return this.repo.setDepotAssistant(depotId, staffId, actorId);
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
