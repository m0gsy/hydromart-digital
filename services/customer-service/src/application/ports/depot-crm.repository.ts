import { MembershipTier } from '../../domain/membership-tier.enum';

/** One row of the depot customer directory (6a). Name/phone come from the primary address. */
export interface DepotCustomerRow {
  customerId: string;
  fullName: string | null;
  phone: string | null;
  membershipTier: MembershipTier;
}

export interface DepotCrmRepository {
  /**
   * Customers associated with a depot — those whose profile favouriteDepotId is this depot.
   * Optional `q` filters on primary-address name or phone (case-insensitive). Ordered by name.
   */
  listDepotCustomers(depotId: string, q?: string): Promise<DepotCustomerRow[]>;

  /** Ids of every customer whose profile favouriteDepotId is this depot (service-to-service lookup). */
  findIdsByDepot(depotId: string): Promise<string[]>;
}
