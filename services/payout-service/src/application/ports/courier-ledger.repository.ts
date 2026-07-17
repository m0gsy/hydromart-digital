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

export interface CourierLedgerRepository {
  create(data: CreateCourierLedgerData): Promise<CourierLedgerEntryRecord>;
  /** The entry with this idempotency ref, if one was already posted. */
  findBySourceRef(sourceRef: string): Promise<CourierLedgerEntryRecord | null>;
  /** Signed sum of every entry for one courier (the available balance). */
  balanceFor(courierId: string): Promise<number>;
  /** Sum of entries of one type since an inclusive date (e.g. this month's earnings). */
  sumByType(courierId: string, type: CourierLedgerEntryType, since: Date): Promise<number>;
  listForCourier(
    courierId: string,
    page: number,
    limit: number,
  ): Promise<{ items: CourierLedgerEntryRecord[]; total: number }>;
  /**
   * The earning rule in force for a depot: the depot's newest rule, or the network
   * default (depotId NULL) when the depot has none. Null if neither exists.
   */
  currentRule(depotId: string | null): Promise<CourierEarningRule | null>;
  /** Every earning rule, newest effective first (rule editor, design 6b). */
  listRules(): Promise<CourierEarningRuleRecord[]>;
  /** Append a new effective-dated rule (network default when depotId is null). */
  createRule(data: CreateEarningRuleData): Promise<CourierEarningRuleRecord>;
}
