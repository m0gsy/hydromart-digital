import { CourierEarningRule, CourierLedgerEntryType } from '../../domain/courier-earning';

export interface CourierLedgerEntryRecord {
  id: string;
  courierId: string;
  depotId: string | null;
  type: CourierLedgerEntryType;
  /** Signed IDR: positive = credit, negative = debit. */
  amount: number;
  description: string;
  sourceRef: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface CreateCourierLedgerData {
  courierId: string;
  depotId: string | null;
  type: CourierLedgerEntryType;
  amount: number;
  description: string;
  sourceRef?: string | null;
  occurredAt?: Date;
}

export interface CourierEarningRuleRecord extends CourierEarningRule {
  id: string;
  depotId: string | null;
  effectiveDate: Date;
  createdAt: Date;
}

export interface CreateEarningRuleData extends CourierEarningRule {
  depotId: string | null;
  effectiveDate: Date;
}

/**
 * What one courier was actually paid at one depot over a window (audit E-1).
 *
 * `earnedIdr` is the credit side of the ledger — the fares plus the incentive rungs that
 * were really posted — not a rate multiplied by a delivery count. `paidDeliveries` counts
 * the EARNING entries behind it, so a depot's own delivered count can be compared against
 * what the payer recorded instead of being multiplied by a second rate nobody pays.
 */
export interface CourierEarningsRow {
  courierId: string;
  earnedIdr: number;
  paidDeliveries: number;
}

export interface CourierLedgerRepository {
  create(data: CreateCourierLedgerData): Promise<CourierLedgerEntryRecord>;
  /** The entry with this idempotency ref, if one was already posted. */
  findBySourceRef(sourceRef: string): Promise<CourierLedgerEntryRecord | null>;
  /** Signed sum of every entry for one courier (the available balance). */
  balanceFor(courierId: string): Promise<number>;
  /**
   * Every courier's paid earnings at one depot over a window, for the depot's commission
   * report (E-1). Credits only — deductions and withdrawals are not pay.
   */
  earningsByDepot(depotId: string, from: Date, to: Date): Promise<CourierEarningsRow[]>;
  /** Sum of entries of one type since an inclusive date (e.g. this month's earnings). */
  sumByType(courierId: string, type: CourierLedgerEntryType, since: Date): Promise<number>;
  /**
   * Count of entries of one type since an inclusive date (e.g. this month's deliveries).
   *
   * `depotId` narrows it, and the incentive ladder needs that: the tiers belong to ONE depot's
   * earning rule and that depot pays the bonus, but the count used to span every depot the
   * courier worked. 30 deliveries at depot A plus 30 at depot B fired depot B's 50-delivery rung
   * on the 50th COMBINED delivery — depot B paying for depot A's work. Omit it for a
   * courier-wide figure (the balance and the month's earnings are personal, not per depot).
   */
  countByType(
    courierId: string,
    type: CourierLedgerEntryType,
    since: Date,
    depotId?: string,
  ): Promise<number>;
  listForCourier(
    courierId: string,
    page: number,
    limit: number,
  ): Promise<{ items: CourierLedgerEntryRecord[]; total: number }>;
  /**
   * The earning rule IN FORCE for a depot at `asOf`: the depot's newest rule whose
   * effective date has arrived, or the network default (depotId NULL) when the depot has
   * none. Null if neither exists.
   *
   * `asOf` is a parameter rather than a `new Date()` inside the query so the boundary is
   * testable at all — the bug this signature exists to close was invisible precisely
   * because nothing could ask "which rule applies on a given day?".
   */
  currentRule(depotId: string | null, asOf?: Date): Promise<CourierEarningRuleRecord | null>;
  /** Every earning rule, newest effective first (rule editor, design 6b). */
  listRules(): Promise<CourierEarningRuleRecord[]>;
  /** Append a new effective-dated rule (network default when depotId is null). */
  createRule(data: CreateEarningRuleData): Promise<CourierEarningRuleRecord>;
  /** One rule by id, or null. Used to decide whether it may still be removed. */
  findRule(id: string): Promise<CourierEarningRuleRecord | null>;
  /** Remove a rule outright. The caller decides whether that is allowed. */
  deleteRule(id: string): Promise<void>;
}
