import { MembershipTier } from '../../domain/membership-tier.enum';

export interface CustomerProfileRecord {
  customerId: string;
  membershipTier: MembershipTier;
  pointBalance: number;
  favoriteDepotId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileRepository {
  findByCustomerId(customerId: string): Promise<CustomerProfileRecord | null>;
  /** Create a default (BASIC, 0 points) profile. */
  create(customerId: string): Promise<CustomerProfileRecord>;
  updateFavoriteDepot(customerId: string, favoriteDepotId: string | null): Promise<CustomerProfileRecord>;
}
