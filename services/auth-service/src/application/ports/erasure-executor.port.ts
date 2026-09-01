/**
 * On-request erasure (UU PDP item 13), as a REGISTRY rather than one method.
 *
 * Retention already works this way: `purge-executor.registry.ts` in admin-service lists
 * every dataset a nightly sweep is allowed to delete, and a dataset absent from that list
 * is reported `UNENFORCED` instead of skipped in silence. Erasure had no counterpart. It
 * had `CustomerDataPort.anonymise()` — one HTTP call to customer-service — and no way to
 * express that anything else in the platform also holds the person who asked to be
 * forgotten.
 *
 * `docs/AUDIT_L3.md` §4.2 measured what that left behind, on the live cluster:
 *
 *   auth.otp_tokens.targetPhone              772 rows
 *   crm.notifications.phone                3.033 rows
 *   crm.campaign_recipients.phone             17 rows
 *   delivery.deliveries.recipientPhone       153 rows
 *   delivery.proofs_of_delivery.recipientName 76 rows
 *   admin.support_tickets.customerPhone        14 rows (+ ticket_messages)
 *   depot.order_disputes.customerName          18 rows
 *   order.subscriptions.phone/recipientName    21 rows  ← still SHIPPING WATER
 *   customer.reseller_profiles                  0 rows  ← exported, never anonymised
 *
 * The last two are the sharp ones. `order.subscriptions` is not history: it is a standing
 * instruction that keeps placing orders to the phone number of somebody who asked to be
 * forgotten. And `customer.reseller_profiles` is read as personal data by `exportFor()` in
 * the same file whose `anonymise()` does not touch it — one file, two methods, one table
 * missed.
 *
 * What this registry promises is not "everything is erased". It is the same promise
 * retention makes: **whatever is not covered is NAMED**. An unconfigured or failing
 * executor is reported, not swallowed, and the request stays open so it can be retried.
 */
export type ErasureCoverage = 'ERASED' | 'EXEMPT' | 'UNENFORCED' | 'FAILED';

export interface ErasureOutcome {
  /** Stable dataset name, e.g. `crm.notifications`. Appears in the audit metadata. */
  dataset: string;
  coverage: ErasureCoverage;
  /** Rows the owner reported changing. Null when it did not say, or nothing ran. */
  rows: number | null;
  /** Why, for EXEMPT and UNENFORCED and FAILED. Empty for ERASED. */
  note: string;
}

/**
 * Who to forget.
 *
 * The PHONE rides along, not only the id. Half the rows that survived erasure are keyed on
 * a phone number with a null `customerId` — a campaign recipient who never registered, a
 * notification sent before the account existed. Passing the id alone leaves exactly those
 * behind, which is how `crm.campaign_recipients` stayed populated.
 *
 * It is read BEFORE the account is anonymised, which is why the fan-out runs before
 * `anonymiseCustomer` and not after.
 */
export interface ErasureSubject {
  customerId: string;
  phone: string | null;
}

export interface ErasureExecutor {
  readonly dataset: string;
  /** False when this environment cannot reach the owner — reported UNENFORCED. */
  readonly configured: boolean;
  /**
   * Set when the dataset is known and DELIBERATELY has no executor yet, with why.
   *
   * `depot.order_disputes` is the case that forced this: the row carries a customer NAME
   * and an order reference and no `customerId`, so erasing by name would delete other
   * people's disputes. The honest answer is UNENFORCED with the reason and the next step,
   * not a wrong delete and not silence — the exact distinction `purge-executor.registry.ts`
   * draws between a dataset with no executor and a dataset nobody listed.
   */
  readonly unenforcedReason?: string;
  /** Idempotent by contract: a retried erasure is not an error. Returns rows changed. */
  erase(subject: ErasureSubject): Promise<number | null>;
}

/**
 * A dataset deliberately NOT erased, with the reason written down.
 *
 * `order.orders` is the one that matters, and it is the one the console audit and
 * `docs/AUDIT_L3.md` disagreed about. AUDIT_L3 is right: the order/payment history is
 * FINANCIAL class, ten years, and the export payload already declares it in `notIncluded`.
 * That is a decision, and a decision written down is not a gap — but it has to be written
 * down HERE too, or the next audit finds the same 813 rows and calls it a defect again.
 */
export interface ErasureExemption {
  dataset: string;
  reason: string;
}

export const ERASURE_EXECUTORS = Symbol('ErasureExecutors');
export const ERASURE_EXEMPTIONS = Symbol('ErasureExemptions');
