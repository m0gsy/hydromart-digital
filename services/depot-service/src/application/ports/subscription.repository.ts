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
  findById(id: string): Promise<Subscription | null>;
  update(id: string, data: UpdateSubscriptionData): Promise<Subscription>;
}
