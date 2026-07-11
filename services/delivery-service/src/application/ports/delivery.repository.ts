import { DeliveryStatus } from '../../domain/delivery-status';

export interface ProofRecord {
  photoUrl: string;
  signatureUrl: string;
  recipientName: string;
  latitude: number;
  longitude: number;
  note: string | null;
  capturedAt: Date;
}

export interface DeliveryStatusHistoryRecord {
  status: DeliveryStatus;
  changedBy: string | null;
  note: string | null;
  createdAt: Date;
}

export interface DeliveryRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  driverId: string;
  depotId: string | null;
  status: DeliveryStatus;
  destinationAddress: string;
  destinationLat: number | null;
  destinationLng: number | null;
  assignedAt: Date;
  pickedUpAt: Date | null;
  startedAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  proof: ProofRecord | null;
  history: DeliveryStatusHistoryRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDeliveryData {
  orderId: string;
  orderNumber: string;
  driverId: string;
  depotId: string | null;
  destinationAddress: string;
  destinationLat: number | null;
  destinationLng: number | null;
}

export interface DeliveryTimestamps {
  pickedUpAt?: Date;
  startedAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  failureReason?: string | null;
}

export interface DeliveryQuery {
  driverId?: string;
  status?: DeliveryStatus;
  page: number;
  limit: number;
}

/** Reporting window. Both bounds optional; open-ended when absent. */
export interface ReportRange {
  from?: Date;
  to?: Date;
}

/** Raw SLA aggregates over the delivery book; formatted into rates by ReportService. */
export interface SlaStats {
  totalDelivered: number;
  onTime: number;
  breached: number;
  /** Sum of delivery minutes ((deliveredAt-assignedAt)/60000) over the delivered set. */
  sumMinutes: number;
  failedCount: number;
}

export interface DeliveryRepository {
  create(data: CreateDeliveryData): Promise<DeliveryRecord>;
  findById(id: string): Promise<DeliveryRecord | null>;
  findByOrder(orderId: string): Promise<DeliveryRecord | null>;
  countActiveByDriver(driverId: string): Promise<number>;
  search(query: DeliveryQuery): Promise<{ items: DeliveryRecord[]; total: number }>;
  /** Move the delivery to `status`, set the matching timestamp, append history. */
  applyStatus(
    id: string,
    status: DeliveryStatus,
    timestamps: DeliveryTimestamps,
    changedBy: string | null,
    note: string | null,
  ): Promise<DeliveryRecord>;
  /** Record proof of delivery and mark the delivery DELIVERED atomically. */
  completeWithProof(
    id: string,
    proof: Omit<ProofRecord, 'capturedAt'>,
    changedBy: string,
  ): Promise<DeliveryRecord>;
  /**
   * Delivery SLA aggregates over the window: delivered on-time vs breached +
   * failures. When `depotIds` is a non-empty array, only deliveries snapshotted
   * to one of those depots count (null-depot deliveries excluded) — used for
   * per-franchise scoping; undefined/empty means all depots (global).
   */
  slaStats(range: ReportRange, thresholdMinutes: number, depotIds?: string[]): Promise<SlaStats>;
}
