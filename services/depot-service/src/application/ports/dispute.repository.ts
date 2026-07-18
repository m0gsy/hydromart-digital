import {
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  OrderDispute,
} from '../../domain/order-dispute';

export interface CreateDisputeData {
  depotId: string;
  orderRef: string;
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
  create(data: CreateDisputeData): Promise<OrderDispute>;
  /** A depot's disputes, newest first; optionally filtered to one status. */
  listForDepot(depotId: string, status?: DisputeStatus): Promise<OrderDispute[]>;
  findById(id: string): Promise<OrderDispute | null>;
  update(id: string, data: UpdateDisputeData): Promise<OrderDispute>;
}
