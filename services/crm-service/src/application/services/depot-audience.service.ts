import { Inject, Injectable } from '@nestjs/common';

import { MAINTENANCE_DUE_DEPOT_ROLE, MAINTENANCE_DUE_HQ_ROLES } from '../../domain/maintenance-due';
import { ApproverDirectoryPort } from '../ports/approver-directory.port';
import { DepotOverseersPort } from '../ports/depot-overseers.port';
import { DepotStaffPort } from '../ports/depot-staff.port';
import { CRM_TOKENS } from '../tokens';

/**
 * Who a depot's management alert reaches (HD-15 maintenance, HD-15B visits): the depot's Kepala,
 * the supervisors over it, and HQ Operasional (HEAD_OFFICE). One place, so the two never drift.
 * Every method THROWS when the roster cannot be read, so a caller can say "retry".
 */
@Injectable()
export class DepotAudienceService {
  constructor(
    @Inject(CRM_TOKENS.ApproverDirectory) private readonly directory: ApproverDirectoryPort,
    @Inject(CRM_TOKENS.DepotStaff) private readonly staff: DepotStaffPort,
    @Inject(CRM_TOKENS.DepotOverseers) private readonly overseers: DepotOverseersPort,
  ) {}

  /** The depot's Kepala and the people over the depot: one set, no one twice. HQ is `hq()`. */
  async depotRecipients(depotId: string): Promise<string[]> {
    const [staffIds, overseers] = await Promise.all([
      this.staff.staffIdsForDepot(depotId),
      this.overseers.overseersOfDepot(depotId),
    ]);
    const roles =
      staffIds.length > 0 ? await this.directory.rolesOf(staffIds) : new Map<string, string>();
    const kepala = staffIds.filter((id) => roles.get(id) === MAINTENANCE_DUE_DEPOT_ROLE);
    return [...new Set([...kepala, ...overseers])];
  }

  /** Active accounts holding an HQ Operasional role, re-checked against their current role. */
  async hq(): Promise<string[]> {
    const ids = await this.directory.staffIdsByRoles(MAINTENANCE_DUE_HQ_ROLES);
    const roles = await this.directory.rolesOf(ids);
    return ids.filter((id) => MAINTENANCE_DUE_HQ_ROLES.includes(roles.get(id) ?? ''));
  }

  /** Both, HQ first-class and de-duplicated: an HQ account that also oversees the depot appears once. */
  async everyone(depotId: string): Promise<string[]> {
    const [depot, hq] = await Promise.all([this.depotRecipients(depotId), this.hq()]);
    return [...new Set([...depot, ...hq])];
  }
}
