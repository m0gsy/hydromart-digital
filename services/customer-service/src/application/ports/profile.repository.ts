import { MembershipTier } from '../../domain/membership-tier.enum';

export interface CustomerProfileRecord {
  customerId: string;
  membershipTier: MembershipTier;
  pointBalance: number;
  favoriteDepotId: string | null;
  birthdate: Date | null;
  lastBirthdayRewardYear: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileRepository {
  findByCustomerId(customerId: string): Promise<CustomerProfileRecord | null>;
  /** Create a default (BASIC, 0 points) profile. */
  create(customerId: string): Promise<CustomerProfileRecord>;
  updateFavoriteDepot(customerId: string, favoriteDepotId: string | null): Promise<CustomerProfileRecord>;
  updateBirthdate(customerId: string, birthdate: Date | null): Promise<CustomerProfileRecord>;
  /**
   * Customer ids whose birthday falls on the given month/day and who have NOT
   * yet been rewarded in `year` (FR-091). Drives the birthday-promo sweep.
   */
  findBirthdayCandidates(month: number, day: number, year: number): Promise<string[]>;
  /** Stamp the last birthday-reward year so a re-run within the same year is a no-op. */
  markBirthdayRewarded(customerId: string, year: number): Promise<void>;
}
