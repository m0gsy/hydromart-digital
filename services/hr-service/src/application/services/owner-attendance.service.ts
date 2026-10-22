import { ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import {
  ATTENDANCE_REPOSITORY,
  AttendanceListRow,
  AttendanceRepository,
  DepotAttendanceSummary,
} from '../ports/attendance.repository';
import { DEPOT_DIRECTORY_PORT, DepotDirectoryPort } from '../ports/depot-directory.port';
import { OWNED_DEPOTS_PORT, OwnedDepotsPort } from '../ports/owned-depots.port';
import { AttendanceService } from './attendance.service';

export interface OwnerSummaryRow extends DepotAttendanceSummary {
  depotName: string | null;
}

/**
 * What a franchise owner may read about attendance at the depots they own.
 *
 * Read-only by construction: this service has no write path, and the controller in front of it
 * carries `hrViewOwn`, held by nobody but owners. Every query is limited to the owner's depots,
 * taken from depot-service (`Depot.ownerId`) on EACH call. Nothing is cached, because a depot sold
 * or reassigned must stop being readable at once, not after a TTL.
 */
@Injectable()
export class OwnerAttendanceService {
  constructor(
    @Inject(ATTENDANCE_REPOSITORY) private readonly repo: AttendanceRepository,
    @Inject(OWNED_DEPOTS_PORT) private readonly owned: OwnedDepotsPort,
    @Inject(DEPOT_DIRECTORY_PORT) private readonly directory: DepotDirectoryPort,
    private readonly attendance: AttendanceService,
  ) {}

  /** The depots this caller owns. Throws 503 (from the port) when that cannot be established. */
  depotsOf(user: AuthenticatedUser): Promise<string[]> {
    return this.owned.depotIdsOf(user.sub);
  }

  /** `requested` narrows the set; a depot outside it is refused, not silently ignored. */
  private narrow(owned: readonly string[], requested?: string): readonly string[] {
    if (!requested) return owned;
    if (!owned.includes(requested)) {
      throw new ForbiddenException('Depot ini bukan milik akun waralaba Anda.');
    }
    return [requested];
  }

  async depots(user: AuthenticatedUser): Promise<{ id: string; name: string | null }[]> {
    const ids = await this.depotsOf(user);
    const names = await this.directory.names(ids);
    return ids.map((id) => ({ id, name: names.get(id) ?? null }));
  }

  async list(
    user: AuthenticatedUser,
    query: {
      depotId?: string;
      employeeId?: string;
      status?: string;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{ rows: AttendanceListRow[]; total: number; page: number; pageSize: number }> {
    const depotIds = this.narrow(await this.depotsOf(user), query.depotId);
    // No depots means NO rows. Passing an empty list through as "no filter" would be the one way
    // this endpoint could return the whole network.
    if (depotIds.length === 0) {
      return { rows: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
    const { rows, total } = await this.repo.list({
      depotIds,
      employeeId: query.employeeId,
      status: query.status as never,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { rows, total, page: query.page, pageSize: query.pageSize };
  }

  async summary(
    user: AuthenticatedUser,
    query: { depotId?: string; from: string; to: string },
  ): Promise<{ from: string; to: string; depots: OwnerSummaryRow[] }> {
    const depotIds = this.narrow(await this.depotsOf(user), query.depotId);
    if (depotIds.length === 0) return { from: query.from, to: query.to, depots: [] };
    const [rows, names] = await Promise.all([
      this.repo.summaryByDepot(depotIds, new Date(query.from), new Date(query.to)),
      this.directory.names(depotIds),
    ]);
    const byDepot = new Map(rows.map((r) => [r.depotId, r]));
    // Every owned depot appears, with zeros where it had no rows: a depot missing from the answer
    // reads as "no such depot", which is not the same as "nobody clocked in".
    const depots = depotIds.map((id) => ({
      ...(byDepot.get(id) ?? {
        depotId: id,
        present: 0,
        late: 0,
        absent: 0,
        leave: 0,
        holiday: 0,
        pending: 0,
        lateMinutes: 0,
        employees: 0,
      }),
      depotName: names.get(id) ?? null,
    }));
    return { from: query.from, to: query.to, depots };
  }

  photo(
    user: AuthenticatedUser,
    id: string,
    which: 'in' | 'out',
  ): Promise<{ body: Buffer; contentType: string }> {
    return this.depotsOf(user).then((owned) => this.attendance.photoForDepots(owned, id, which));
  }
}
