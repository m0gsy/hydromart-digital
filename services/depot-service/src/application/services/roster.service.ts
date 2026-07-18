import { Inject, Injectable } from '@nestjs/common';

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

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  /** Every cell recorded for a depot's week. */
  async week(depotId: string, weekStart: string): Promise<ShiftAssignment[]> {
    await this.requireDepot(depotId);
    return this.roster.listForWeek(depotId, weekStart);
  }

  /** Set (create or overwrite) one staff member's shift on one day. */
  async setCell(
    depotId: string,
    weekStart: string,
    staffId: string,
    staffName: string,
    day: number,
    shift: ShiftKind,
  ): Promise<ShiftAssignment> {
    await this.requireDepot(depotId);
    return this.roster.upsertCell({ depotId, weekStart, staffId, staffName, day, shift });
  }

  /** Set many cells of one week at once. */
  async bulkSet(depotId: string, weekStart: string, cells: ShiftCell[]): Promise<ShiftAssignment[]> {
    await this.requireDepot(depotId);
    return this.roster.bulkUpsert(cells.map((c) => ({ depotId, weekStart, ...c })));
  }
}
