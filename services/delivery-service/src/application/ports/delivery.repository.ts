import { DeliveryStatus } from '../../domain/delivery-status';
import { ContactMethod, ContactState } from '../../domain/no-show';

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
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
  assignedAt: Date;
  pickedUpAt: Date | null;
  startedAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  rescheduledFor: Date | null;
  rescheduleSlot: string | null;
  rescheduleNote: string | null;
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
  rescheduledFor?: Date;
  rescheduleSlot?: string | null;
  rescheduleNote?: string | null;
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

/** Per-depot SLA aggregates (one row per attributed depot); no failedCount — the
 * network roll-up only needs the on-time rate + average, not failure counts. */
export interface DepotSlaStats {
  depotId: string;
  totalDelivered: number;
  onTime: number;
  breached: number;
  sumMinutes: number;
}

export interface DeliveryRepository {
  create(data: CreateDeliveryData): Promise<DeliveryRecord>;
  findById(id: string): Promise<DeliveryRecord | null>;
  findByOrder(orderId: string): Promise<DeliveryRecord | null>;
  countActiveByDriver(driverId: string): Promise<number>;
  /** Append a contact attempt (design 5a) and return the updated contact state. */
  recordContactAttempt(
    deliveryId: string,
    driverId: string,
    method: ContactMethod,
    note: string | null,
  ): Promise<ContactState>;
  /** Contact-attempt count + first attempt time, for the no-show gate. */
  contactState(deliveryId: string): Promise<ContactState>;
  search(query: DeliveryQuery): Promise<{ items: DeliveryRecord[]; total: number }>;
  /**
   * Order ids the driver DELIVERED with `deliveredAt` in [from, to] — the orders a
   * shift's COD settlement is computed over. payment-service then filters these to
   * PAID cash, so this returns every delivered order, cash or not.
   */
  deliveredOrderIdsInWindow(driverId: string, from: Date, to: Date): Promise<string[]>;
  /** Overwrite the delivery's latest reported driver position (live tracking). */
  updateLocation(id: string, lat: number, lng: number): Promise<DeliveryRecord>;
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
   * UU PDP retention: delete proof-of-delivery rows (photo/signature URL,
   * recipient name, GPS) captured before `cutoff`. Returns the count deleted.
   * The underlying image files are expired separately by a bucket lifecycle rule.
   */
  purgeProofsBefore(cutoff: Date): Promise<number>;
  /**
   * Delivery SLA aggregates over the window: delivered on-time vs breached +
   * failures. When `depotIds` is a non-empty array, only deliveries snapshotted
   * to one of those depots count (null-depot deliveries excluded) — used for
   * per-franchise scoping; undefined/empty means all depots (global).
   */
  slaStats(range: ReportRange, thresholdMinutes: number, depotIds?: string[]): Promise<SlaStats>;
  /**
   * SLA aggregates grouped per depot over the window. Deliveries with a null
   * depotId are excluded (unattributable). Powers the HQ network roll-up
   * (dashboard-service) — one row per depot that has ≥1 delivered order.
   */
  slaStatsByDepot(range: ReportRange, thresholdMinutes: number): Promise<DepotSlaStats[]>;
}
