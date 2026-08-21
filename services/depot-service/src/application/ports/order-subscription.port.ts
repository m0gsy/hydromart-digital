/**
 * D10: the subscription engine, as depot-service asks it.
 *
 * A depot-side "plan" used to produce nothing — no sweep, nothing writing a next run, and a
 * screen showing a date that froze where the operator typed it and drifted further into the
 * past every day. Rather than growing a second engine here, the depot asks the one that
 * already exists: order-service subscriptions, the engine D1, D2, D4, D6, D8 and D9
 * repaired.
 */
export interface CreateEngineSubscriptionInput {
  customerId: string;
  productId: string;
  quantity: number;
  /** The engine's own cadence vocabulary. */
  frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  firstDeliveryAt: Date;
}

/**
 * Fails CLOSED, unlike most ports here. A depot row saved without its engine subscription
 * is exactly the thing D10 exists to remove: a plan the console shows and nothing runs. The
 * operator has to be told it did not work while they are still on the screen.
 */
export interface OrderSubscriptionPort {
  /** The engine's subscription id, or a thrown error naming why it could not be made. */
  create(input: CreateEngineSubscriptionInput): Promise<string>;
}
