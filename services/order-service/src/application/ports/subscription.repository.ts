import { DeliveryAddressSnapshot } from './order.repository';

export type SubscriptionFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

export interface SubscriptionRecord extends DeliveryAddressSnapshot {
  id: string;
  customerId: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  frequency: SubscriptionFrequency;
  status: SubscriptionStatus;
  nextDeliveryAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionData extends DeliveryAddressSnapshot {
  customerId: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  frequency: SubscriptionFrequency;
  nextDeliveryAt: Date;
}

/** Per-plan active-subscriber count (18c network aggregate). */
export interface SubscriptionPlanCount {
  productName: string;
  frequency: SubscriptionFrequency;
  subscribers: number;
}

/** Network subscription totals (18c). Rupiah MRR is not derivable here — the
 * subscription row snapshots no price — so the service reports an estimated
 * monthly delivery volume instead (labelled as an estimate in the UI). */
export interface SubscriptionNetworkSummary {
  activeSubscriptions: number;
  activeSubscribers: number;
  plans: SubscriptionPlanCount[];
}

export interface SubscriptionRepository {
  create(data: CreateSubscriptionData): Promise<SubscriptionRecord>;
  findById(id: string): Promise<SubscriptionRecord | null>;
  listByCustomer(customerId: string): Promise<SubscriptionRecord[]>;
  /** ACTIVE subscriptions whose next delivery is due at or before `now`. */
  findDue(now: Date): Promise<SubscriptionRecord[]>;
  setStatus(id: string, status: SubscriptionStatus): Promise<SubscriptionRecord>;
  advance(id: string, nextDeliveryAt: Date): Promise<SubscriptionRecord>;
  /** Network aggregate of ACTIVE subscriptions for the HQ console (18c). */
  networkSummary(): Promise<SubscriptionNetworkSummary>;
}
