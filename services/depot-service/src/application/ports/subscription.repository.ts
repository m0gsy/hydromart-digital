import { Subscription, SubscriptionCadence, SubscriptionStatus } from '../../domain/subscription';

export interface CreateSubscriptionData {
  depotId: string;
  customerId: string | null;
  customerName: string;
  productLabel: string;
  quantity: number;
  cadence: SubscriptionCadence;
  nextRunAt: Date | null;
  note: string | null;
}

/** Partial patch: status transition (pause/resume). */
export interface UpdateSubscriptionData {
  status?: SubscriptionStatus;
}

export interface SubscriptionRepository {
  create(data: CreateSubscriptionData): Promise<Subscription>;
  /** A depot's subscriptions, newest first; optionally filtered to one status. */
  listForDepot(depotId: string, status?: SubscriptionStatus): Promise<Subscription[]>;
  /**
   * Distinct linked customer ids with an ACTIVE subscription at this depot (S2).
   *
   * Only rows that carry a `customerId`. A subscription typed in as free text is not
   * "no subscription", it is one nobody linked to an account — which is why the create
   * route now insists on a real customer rather than leaving the gap open.
   */
  activeCustomerIdsForDepot(depotId: string): Promise<string[]>;
  findById(id: string): Promise<Subscription | null>;
  update(id: string, data: UpdateSubscriptionData): Promise<Subscription>;
}
