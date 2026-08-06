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

/** A broadcast recipient resolved from a customer's primary address (FR-087). */
export interface DirectoryRecipient {
  customerId: string;
  name: string;
  phone: string;
}

/** Attribute filter for the CRM broadcast audience (FR-087). Empty = all reachable customers. */
export interface SegmentFilter {
  tier?: MembershipTier;
  city?: string;
}

export interface ProfileRepository {
  findByCustomerId(customerId: string): Promise<CustomerProfileRecord | null>;
  /** Whether a customer profile exists for this id (reseller registration precondition). */
  exists(customerId: string): Promise<boolean>;
  /** Create a default (BASIC, 0 points) profile. */
  create(customerId: string): Promise<CustomerProfileRecord>;
  updateFavoriteDepot(customerId: string, favoriteDepotId: string | null): Promise<CustomerProfileRecord>;
  /**
   * Ensure a profile exists and point it at this depot, in one statement (audit S-16).
   * The bulk importer used to ask "does it exist", create it, then update it — three
   * round-trips per imported row, and rows are processed one at a time on purpose so
   * each can report its own error.
   */
  upsertFavoriteDepot(customerId: string, favoriteDepotId: string): Promise<CustomerProfileRecord>;
  /**
   * Point a customer at this depot ONLY if they have no favourite yet (§I).
   *
   * The unqualified upsert above is the importer's: a depot typing somebody into its
   * spreadsheet is claiming them. This one is order-service reporting a first checkout, and
   * it must never move a customer a depot already recorded — or the last depot to sell them
   * water would silently steal them from whoever they actually belong to. Returns whether it
   * wrote, so the caller can say so.
   */
  claimFavoriteDepotIfUnset(customerId: string, favoriteDepotId: string): Promise<boolean>;
  updateBirthdate(customerId: string, birthdate: Date | null): Promise<CustomerProfileRecord>;
  /**
   * Customer ids whose birthday falls on the given month/day and who have NOT
   * yet been rewarded in `year` (FR-091). Drives the birthday-promo sweep.
   */
  findBirthdayCandidates(month: number, day: number, year: number): Promise<string[]>;
  /** Stamp the last birthday-reward year so a re-run within the same year is a no-op. */
  markBirthdayRewarded(customerId: string, year: number): Promise<void>;
  /**
   * Broadcast recipients matching an attribute segment (FR-087). Joins each profile to its
   * PRIMARY address for a reachable phone + name; customers without a primary address are
   * excluded (nothing to broadcast to).
   */
  findSegment(filter: SegmentFilter): Promise<DirectoryRecipient[]>;
}
