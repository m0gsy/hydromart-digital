import {
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  OrderDispute,
} from '../../domain/order-dispute';

export interface CreateDisputeData {
  depotId: string;
  orderRef: string;
  /** DPT-2: the account raising it, when there is one. Null for a walk-in at the counter. */
  customerId?: string | null;
  customerName: string;
  category: DisputeCategory;
  description: string;
  amountIdr: number;
  courierName: string | null;
  raisedBy: string;
}

/** Partial patch: resolution/rejection fields. */
export interface UpdateDisputeData {
  status?: DisputeStatus;
  resolution?: DisputeResolution | null;
  resolutionNote?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
}

export interface DisputeRepository {
  /**
   * DPT-2: erase one person from everything this service holds about them.
   *
   * depot-service keeps customer PII in three places nobody could reach from the deletion
   * path: a dispute's complainant name and free-text description, an incident's callback
   * phone, and a subscription's customer name. `depot.order_disputes` has been reported
   * UNENFORCED since the `customerId` column shipped, which was honest and is now overdue:
   * the column is on the live database, so the executor it was waiting for can exist.
   *
   * Matched by id AND by phone, because the two rows key differently: a dispute carries the
   * account id (null for a walk-in), while an incident only ever carries the number the
   * operator wrote down.
   */
  erasePerson(customerId: string, phone: string | null): Promise<number>;
  create(data: CreateDisputeData): Promise<OrderDispute>;
  /** A depot's disputes, newest first; optionally filtered to one status. */
  listForDepot(depotId: string, status?: DisputeStatus): Promise<OrderDispute[]>;
  findById(id: string): Promise<OrderDispute | null>;
  update(id: string, data: UpdateDisputeData): Promise<OrderDispute>;
}
