import { MembershipTier } from '../../domain/membership-tier.enum';

/**
 * One row of the depot customer directory (6a). Name/phone here are the PRIMARY ADDRESS's
 * — the fallback only. The account name is the real one and lives in auth-service, so the
 * service layer overlays it before anything reaches the client.
 */
export interface DepotCustomerRow {
  customerId: string;
  fullName: string | null;
  phone: string | null;
  membershipTier: MembershipTier;
}

export interface DepotCrmRepository {
  /**
   * Customers associated with a depot — those whose profile favouriteDepotId is this depot.
   * Ordered by address name. Unfiltered on purpose: the searchable name is the account
   * name, which this database does not hold, so the service filters after the overlay.
   */
  listDepotCustomers(depotId: string): Promise<DepotCustomerRow[]>;

  /** Ids of every customer whose profile favouriteDepotId is this depot (service-to-service lookup). */
  findIdsByDepot(depotId: string): Promise<string[]>;
}
