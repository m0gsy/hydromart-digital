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
  /** The depot making the plan: the engine refuses one whose address another depot serves. */
  depotId: string;
}

/**
 * Fails CLOSED, unlike most ports here. A depot row saved without its engine subscription
 * is exactly the thing D10 exists to remove: a plan the console shows and nothing runs. The
 * operator has to be told it did not work while they are still on the screen.
 */
export interface OrderSubscriptionPort {
  /** The engine's subscription id, or a thrown error naming why it could not be made. */
  /**
   * The engine's id for the plan, and the depot whose area its pin is in — who delivers,
   * prices and is credited for it (owner decision 2026-11-21). Absent from older engines.
   */
  create(input: CreateEngineSubscriptionInput): Promise<{ id: string; servingDepotId?: string }>;
  /**
   * DEP-23: pause/resume were local-only, so a plan the operator paused kept placing (and
   * billing) deliveries from the engine. Same posture as `create`: throws when the engine
   * could not be told, and the caller then leaves its own row untouched.
   */
  pause(engineId: string): Promise<void>;
  resume(engineId: string): Promise<void>;
  /**
   * Owner decision 2026-11-21: where each engine plan delivers from now — the depot its pin is
   * in (null: none serves it). Plans the engine does not know are absent from the map. Throws
   * when the engine cannot answer; the caller then moves nothing.
   */
  servingDepots(engineIds: readonly string[]): Promise<Map<string, string | null>>;
}
