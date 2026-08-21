// Customer recurring subscriptions (design 16b). A standing order (N units on a cadence)
// the manager manages. Mirrors the Prisma enums; the domain never imports the client.

export enum SubscriptionCadence {
  DAILY = 'DAILY',
  EVERY_3_DAYS = 'EVERY_3_DAYS',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
}

/** A depot-scoped customer recurring subscription (design 16b). */
export interface Subscription {
  id: string;
  depotId: string;
  customerId: string | null;
  customerName: string;
  productLabel: string;
  quantity: number;
  cadence: SubscriptionCadence;
  status: SubscriptionStatus;
  nextRunAt: Date | null;
  /** D10: what the operator picked; a label cannot be delivered. */
  productId: string | null;
  /** D10: the engine subscription this row stands for. Null = created before the link. */
  orderSubscriptionId: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}
