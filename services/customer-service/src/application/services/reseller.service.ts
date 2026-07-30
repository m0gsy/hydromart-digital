import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, assertDepotAccess, depotScopeFilter } from '@hydromart/platform';

import {
  CreateResellerData,
  Reseller,
  ResellerRepository,
  UpdateResellerData,
} from '../ports/reseller.repository';
import { ProfileRepository } from '../ports/profile.repository';
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
 * (MANAGER) is forced to their OWN depot on list/register (depotScopeFilter — same
 * helper every other staff list endpoint uses) and rejected with Forbidden on get/update of a
 * reseller homed at another depot (assertDepotAccess — the by-id vector DepotScopeGuard can't
 * see, per its own class doc).
 */
@Injectable()
export class ResellerService {
  constructor(
    @Inject(CUSTOMER_TOKENS.ResellerRepository) private readonly resellers: ResellerRepository,
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
  ) {}

  async list(
    user: AuthenticatedUser,
    filter: { homeDepotId?: string; active?: boolean },
  ): Promise<Reseller[]> {
    const homeDepotId = depotScopeFilter(user, filter.homeDepotId);
    return this.resellers.list({ homeDepotId, active: filter.active });
  }

  async get(user: AuthenticatedUser, customerId: string): Promise<Reseller> {
    const found = await this.resellers.findById(customerId);
    if (!found) throw new ResellerNotFoundError();
    assertDepotAccess(user, found.homeDepotId);
    return found;
  }

  async register(user: AuthenticatedUser, data: CreateResellerData): Promise<Reseller> {
    // Forced to the caller's own depot for depot-locked roles; HQ keeps the free selector.
    const homeDepotId = depotScopeFilter(user, data.homeDepotId) ?? data.homeDepotId;
    // The profile row is customer-service's lazily-created shell for a customer — it only
    // appears once that customer opens something that reads it. Demanding one up front made
    // a real, signed-up customer unenrollable purely because they had never viewed their
    // profile, so create the shell here instead of rejecting.
    if (!(await this.profiles.exists(data.customerId))) {
      await this.profiles.create(data.customerId);
    }
    if (await this.resellers.findById(data.customerId)) throw new ResellerExistsError();
    return this.resellers.create({ ...data, homeDepotId });
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
