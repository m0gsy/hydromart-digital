import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, assertDepotAccess, depotScopeIds } from '@hydromart/platform';

import {
  CreateResellerData,
  Reseller,
  ResellerRepository,
  UpdateResellerData,
} from '../ports/reseller.repository';
import { ProfileRepository } from '../ports/profile.repository';
import { IdentityPort } from '../ports/identity.port';
import {
  ResellerExistsError,
  ResellerNotFoundError,
} from '../../domain/errors';
import { CUSTOMER_TOKENS } from '../tokens';

/**
 * Reseller registry. A reseller must be an existing customer; each customer can be a
 * reseller at most once (customerId is the PK). Deactivation is soft (active=false).
 *
 * Tenant isolation: HQ (HEAD_OFFICE/SUPER_ADMIN) may act on any depot. A depot-locked caller
 * (MANAGER) is forced to their OWN depot on list/register (depotScopeIds — same
 * helper every other staff list endpoint uses) and rejected with Forbidden on get/update of a
 * reseller homed at another depot (assertDepotAccess — the by-id vector DepotScopeGuard can't
 * see, per its own class doc).
 */
export type ResellerView = Reseller & {
  /** The account name behind `customerId`; null when auth-service has none or is down. */
  customerName: string | null;
};

@Injectable()
export class ResellerService {
  constructor(
    @Inject(CUSTOMER_TOKENS.ResellerRepository) private readonly resellers: ResellerRepository,
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
    @Inject(CUSTOMER_TOKENS.IdentityPort) private readonly identity: IdentityPort,
  ) {}

  /**
   * §G-3: the roster carried the customer id and nothing else, so the HR console rendered a
   * 36-character UUID as the entire "Customer" column. The name lives on the account, which
   * is auth-service's row, so it is asked for here rather than copied into this table.
   *
   * Fail-soft by construction (see IdentityPort): an unreachable auth-service costs the
   * names, never the roster.
   */
  async list(
    user: AuthenticatedUser,
    filter: { homeDepotId?: string; active?: boolean },
  ): Promise<ResellerView[]> {
    const homeDepotIds = depotScopeIds(user, filter.homeDepotId);
    const rows = await this.resellers.list({ homeDepotIds, active: filter.active });
    const names = await this.identity.getCustomerNames(rows.map((r) => r.customerId));
    return rows.map((r) => ({ ...r, customerName: names.get(r.customerId)?.fullName ?? null }));
  }

  async get(user: AuthenticatedUser, customerId: string): Promise<Reseller> {
    const found = await this.resellers.findById(customerId);
    if (!found) throw new ResellerNotFoundError();
    assertDepotAccess(user, found.homeDepotId);
    return found;
  }

  async register(user: AuthenticatedUser, data: CreateResellerData): Promise<Reseller> {
    // Forced to the caller's own depot for depot-locked roles; HQ keeps the free selector.
    // A reseller lives at exactly ONE depot; the scope call is here to REJECT a depot the
    // caller has no business writing to, not to widen the write.
    depotScopeIds(user, data.homeDepotId);
    // The profile row is customer-service's lazily-created shell for a customer — it only
    // appears once that customer opens something that reads it. Demanding one up front made
    // a real, signed-up customer unenrollable purely because they had never viewed their
    // profile, so create the shell here instead of rejecting.
    if (!(await this.profiles.exists(data.customerId))) {
      await this.profiles.create(data.customerId);
    }
    if (await this.resellers.findById(data.customerId)) throw new ResellerExistsError();
    return this.resellers.create({ ...data, homeDepotId: data.homeDepotId });
  }

  async update(user: AuthenticatedUser, customerId: string, patch: UpdateResellerData): Promise<Reseller> {
    const current = await this.resellers.findById(customerId);
    if (!current) throw new ResellerNotFoundError();
    assertDepotAccess(user, current.homeDepotId);
    // Block moving the reseller into a depot the caller can't touch.
    if (patch.homeDepotId) assertDepotAccess(user, patch.homeDepotId);
    return this.resellers.update(customerId, patch);
  }

  /** The caller's own reseller row (self endpoint), or null if they are not a reseller. */
  async findMy(customerId: string): Promise<Reseller | null> {
    return this.resellers.findById(customerId);
  }
}
