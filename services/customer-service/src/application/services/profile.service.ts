import { Inject, Injectable } from '@nestjs/common';

import {
  CustomerProfileRecord,
  ProfileRepository,
} from '../ports/profile.repository';
import { CUSTOMER_TOKENS } from '../tokens';

/** Customer profile extension: membership/points (read-only here) + favorite depot. */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(CUSTOMER_TOKENS.ProfileRepository) private readonly profiles: ProfileRepository,
  ) {}

  /** Get the profile, lazily creating a default one on first access. */
  async get(customerId: string): Promise<CustomerProfileRecord> {
    const existing = await this.profiles.findByCustomerId(customerId);
    return existing ?? (await this.profiles.create(customerId));
  }

  async setFavoriteDepot(
    customerId: string,
    favoriteDepotId: string | null,
  ): Promise<CustomerProfileRecord> {
    await this.get(customerId); // ensure a row exists
    return this.profiles.updateFavoriteDepot(customerId, favoriteDepotId);
  }
}
