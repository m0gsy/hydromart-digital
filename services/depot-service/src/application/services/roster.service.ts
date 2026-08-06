import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import { ShiftAssignment, ShiftKind } from '../../domain/shift';
import { DepotNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { RosterRepository, UpsertShiftData } from '../ports/roster.repository';
import { DEPOT_TOKENS } from '../tokens';

/** One cell in a bulk set (identifying staff + its day/shift). */
export type ShiftCell = Pick<UpsertShiftData, 'staffId' | 'staffName' | 'day' | 'shift'>;

/**
 * Courier shift roster (design: operator cell 6d "Jadwal shift kurir" + manager cell 7b).
 * A depot-scoped weekly grid — one cell per (staff, day) — that ops fill in Pagi/Sore/Libur.
 */
@Injectable()
export class RosterService {
  constructor(
    @Inject(DEPOT_TOKENS.RosterRepository) private readonly roster: RosterRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  /**
   * B1: the caller may touch this depot, AND the depot exists — in that order.
   *
   * `requireDepot` alone answered only the second question, so `depotId` came straight off
   * the query string and the body with nothing checking whose depot it was. The pattern is
   * `settings.controller` / `hierarchy.controller`'s, and `assertDepotAccess` is a no-op for
   * roles that are not depot-bound, so HQ keeps the whole network.
   *
   * Access first: a 403 must not double as a way to probe which depot ids exist.
   */
  private async requireDepot(user: AuthenticatedUser, depotId: string): Promise<void> {
    assertDepotAccess(user, depotId);
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  /** Every cell recorded for a depot's week. */
  async week(
    user: AuthenticatedUser,
    depotId: string,
    weekStart: string,
  ): Promise<ShiftAssignment[]> {
    await this.requireDepot(user, depotId);
    return this.roster.listForWeek(depotId, weekStart);
  }

  /** Set (create or overwrite) one staff member's shift on one day. */
  async setCell(
    user: AuthenticatedUser,
    depotId: string,
    weekStart: string,
    staffId: string,
    staffName: string,
    day: number,
    shift: ShiftKind,
  ): Promise<ShiftAssignment> {
    await this.requireDepot(user, depotId);
    return this.roster.upsertCell({ depotId, weekStart, staffId, staffName, day, shift });
  }

  /** Set many cells of one week at once. */
  async bulkSet(
    user: AuthenticatedUser,
    depotId: string,
    weekStart: string,
    cells: ShiftCell[],
  ): Promise<ShiftAssignment[]> {
    await this.requireDepot(user, depotId);
    return this.roster.bulkUpsert(cells.map((c) => ({ depotId, weekStart, ...c })));
  }
}
