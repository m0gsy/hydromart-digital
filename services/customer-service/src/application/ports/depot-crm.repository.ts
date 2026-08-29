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

/**
 * One page of the depot customer directory.
 *
 * W9. This read had no bound of any kind. It is a `$queryRaw`, and the Prisma query-bounds
 * middleware every PrismaService installs returns early for anything whose action is not
 * `findMany` (packages/platform/src/nest/query-bounds.ts) — so the 500-row ceiling the rest
 * of this service inherits never applied here. A depot with a few thousand customers would
 * have read, enriched and serialised all of them on every page open.
 */
export interface DepotCustomerQuery {
  /**
   * Case-insensitive substring, matched IN SQL against the primary address recipient name
   * and phone. It used to be matched in memory after the whole directory had been read and
   * decorated, which made one keystroke cost the size of the depot.
   */
  q?: string;
  /**
   * §I's third membership source: the ids order-service reports as having ordered at this
   * depot. They join the members CTE rather than being merged in afterwards — a merge that
   * happens after a LIMIT lists the same customer on two different pages.
   */
  orderedIds?: string[];
  /**
   * Subset of `orderedIds` whose ORDER-SNAPSHOT name or phone matched `q`. Those names are
   * order-service's, not this database's, so the only way they can narrow the query is as
   * ids. Ignored when `q` is absent.
   */
  qMatchedIds?: string[];
  /** Rows per page. Defaults to the platform ceiling the middleware would have imposed. */
  limit?: number;
  offset?: number;
}

export interface DepotCrmRepository {
  /**
   * One page of the customers associated with a depot: favourite depot, reseller home
   * depot, or an order placed here. Ordered by address name and then by id — the keyset
   * rule in packages/platform/src/domain/keyset.ts — so pages cannot repeat or skip a row.
   *
   * Searching happens HERE now, over the columns this database actually holds. The account
   * name the operator sees is auth-service's and is still overlaid by the service layer
   * afterwards; it cannot narrow the query because nothing here can search it.
   */
  listDepotCustomers(depotId: string, query?: DepotCustomerQuery): Promise<DepotCustomerRow[]>;

  /** Ids of every customer whose profile favouriteDepotId is this depot (service-to-service lookup). */
  findIdsByDepot(depotId: string): Promise<string[]>;
}
