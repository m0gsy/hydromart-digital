import { Inject, Injectable } from '@nestjs/common';

import {
  CreateResellerData,
  Reseller,
  ResellerRepository,
  UpdateResellerData,
} from '../ports/reseller.repository';
import { ProfileRepository } from '../ports/profile.repository';
import {
  CustomerNotFoundError,
  ResellerExistsError,
  ResellerNotFoundError,
} from '../../domain/errors';
import { CUSTOMER_TOKENS } from '../tokens';

/**
 * Reseller registry. A reseller must be an existing customer; each customer can be a
 * reseller at most once (customerId is the PK). Deactivation is soft (active=false).
 */
@Injectable()
export class ResellerService {
  constructor(
    @Inject(CUSTOMER_TOKENS.ResellerRepository) private readonly resellers: ResellerRepository,
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
  ) {}

  list(filter: { homeDepotId?: string; active?: boolean }): Promise<Reseller[]> {
    return this.resellers.list(filter);
  }

  async get(customerId: string): Promise<Reseller> {
    const found = await this.resellers.findById(customerId);
    if (!found) throw new ResellerNotFoundError();
    return found;
  }

  async register(data: CreateResellerData): Promise<Reseller> {
    if (!(await this.profiles.exists(data.customerId))) throw new CustomerNotFoundError();
    if (await this.resellers.findById(data.customerId)) throw new ResellerExistsError();
    return this.resellers.create(data);
  }

  async update(customerId: string, patch: UpdateResellerData): Promise<Reseller> {
    if (!(await this.resellers.findById(customerId))) throw new ResellerNotFoundError();
    return this.resellers.update(customerId, patch);
  }
}
