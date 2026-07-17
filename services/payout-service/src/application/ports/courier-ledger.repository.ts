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
}
