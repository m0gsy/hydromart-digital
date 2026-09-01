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
  /** D2: consecutive failed cycles. 0 whenever the last one landed. */
  failureCount: number;
  lastFailureAt: Date | null;
  lastFailure: string | null;
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
  /**
   * D8: bounded, oldest first. The sweep places a real order per row, serially, inside one
   * request — so an unbounded read is a backlog the tick cannot finish, and it dies
   * somewhere in the middle with no record of where. `limit` caps one tick; the next tick
   * continues from what is still due.
   *
   * Note the bound alone does not rescue a queue whose HEAD keeps failing: those rows never
   * advance, so they are re-read every tick and eventually fill the batch. That is D2b's
   * job — the failure counter that stops asking.
   */
  findDue(now: Date, limit?: number): Promise<SubscriptionRecord[]>;
  setStatus(id: string, status: SubscriptionStatus): Promise<SubscriptionRecord>;
  /**
   * K1.9: move a plan to a different saved address.
   *
   * The address is a SNAPSHOT and stays one — the plan holds its own copy so that editing
   * an address book entry cannot silently re-route a standing order, and so the depot the
   * sweep prices against (D7) cannot move under it. This is the deliberate move, made by
   * the customer, and it is the only way the snapshot changes after creation.
   */
  setDeliveryAddress(id: string, address: DeliveryAddressSnapshot): Promise<SubscriptionRecord>;
  /**
   * D4: resume, which is a status change AND a schedule move in one write.
   *
   * Two writes would leave a window where the plan is ACTIVE holding a due date in the
   * past — and the sweep runs on a timer, so that window is exactly long enough for it to
   * place the delivery the resume was meant to postpone.
   */
  resume(id: string, nextDeliveryAt: Date): Promise<SubscriptionRecord>;
  /**
   * Moves the schedule on, but only from the date the sweep read (H-3).
   *
   * The compare-and-set is what makes one due delivery advance once: a second sweep
   * holding the same row finds the schedule already moved, matches nothing, and gets
   * `false` — so it neither re-advances the plan nor counts a delivery it did not make.
   */
  advance(id: string, from: Date, to: Date): Promise<boolean>;
  /**
   * D2: one more consecutive failed cycle, with what went wrong. Returns the new count so
   * the caller can decide whether this plan has stopped being worth asking.
   *
   * Consecutive, not cumulative: `advance` clears it on any success, so the number always
   * describes an outage happening NOW rather than a lifetime tally. A plan that failed once
   * a year ago and has delivered every week since is not in trouble.
   */
  recordFailure(id: string, message: string, at: Date): Promise<number>;
  /**
   * UU PDP item 13: forget one person's standing instructions.
   *
   * Two writes, one transaction, and the ORDER matters. A subscription is not history: it
   * is an instruction that keeps placing orders. `docs/AUDIT_L3.md` §4.2 measured 21 rows
   * still carrying the name and phone of somebody who had asked to be forgotten — and the
   * nightly sweep was still shipping water to them (the console audit's second Kritis).
   *
   * So: CANCEL first, then scrub the snapshot. Scrubbing an ACTIVE plan would keep the
   * water going to the same door under a blank name, which is worse than doing nothing.
   *
   * Orders themselves are NOT touched: FINANCIAL class, ten years, declared in the export
   * payload's `notIncluded` and in the erasure registry's written exemptions.
   *
   * Idempotent: a retry finds the rows already cancelled and scrubbed, and reports them
   * again rather than failing.
   */
  erasePerson(customerId: string): Promise<number>;

  /** Network aggregate of ACTIVE subscriptions for the HQ console (18c). */
  networkSummary(): Promise<SubscriptionNetworkSummary>;
}
