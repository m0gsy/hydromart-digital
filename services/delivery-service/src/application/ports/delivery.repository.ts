import { DeliveryStatus } from '../../domain/delivery-status';
import { ContactMethod, ContactState } from '../../domain/no-show';

export interface ProofRecord {
  photoUrl: string;
  signatureUrl: string | null;
  recipientName: string;
  latitude: number;
  longitude: number;
  note: string | null;
  capturedAt: Date;
}

/** One order line snapshotted onto the delivery for the courier manifest. */
export interface DeliveryItem {
  name: string;
  qty: number;
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
  recipientPhone: string | null;
  items: DeliveryItem[] | null;
  codAmount: number | null;
  notes: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
  estimatedArrivalAt: Date | null;
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
  recipientPhone: string | null;
  items: DeliveryItem[] | null;
  codAmount: number | null;
  notes: string | null;
}

export interface DeliveryTimestamps {
  pickedUpAt?: Date;
  startedAt?: Date;
  estimatedArrivalAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  failureReason?: string | null;
  rescheduledFor?: Date;
  rescheduleSlot?: string | null;
  rescheduleNote?: string | null;
}

export interface DeliveryQuery {
  driverId?: string;
  /** Depot to scope to. When set, only that depot's deliveries match (null-depot rows excluded). */
  depotId?: string;
  status?: DeliveryStatus;
  page: number;
  limit: number;
}

/** Reporting window. Both bounds optional; open-ended when absent. */
export interface ReportRange {
  from?: Date;
  to?: Date;
}

/** A delivered delivery reduced to what the weekly performance roll-up needs (4c). */
export interface DeliveredRow {
  orderId: string;
  assignedAt: Date;
  deliveredAt: Date;
}

/** One depot-leaderboard row: a driver and their delivered count in the window (4c). */
export interface DepotDeliveredCount {
  driverId: string;
  count: number;
}

/** Depot-scoped courier activity used by the manager team report. */
export interface DepotCourierActivity {
  driverId: string;
  delivered: DeliveredRow[];
  failed: number;
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
  /**
   * Deliveries the driver DELIVERED in [from, to) — timestamps + order id, for the
   * weekly performance roll-up (count, per-day bars, on-time rate, rating batch). 4c.
   */
  driverDeliveredInWindow(driverId: string, from: Date, to: Date): Promise<DeliveredRow[]>;
  /** How many of the driver's deliveries FAILED (failedAt) in [from, to). 4c. */
  driverFailedCountInWindow(driverId: string, from: Date, to: Date): Promise<number>;
  /**
   * Delivered-count per driver at `depotId` in [from, to) — the depot leaderboard the
   * courier's weekly rank is read off (design 4c). Only drivers with ≥1 delivery appear.
   */
  depotDeliveredCountsInWindow(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<DepotDeliveredCount[]>;
  /** Delivered orders and failures per courier at one depot in [from,to). */
  depotCourierActivityInWindow(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<DepotCourierActivity[]>;
  /** Overwrite the latest driver position and refresh ETA when one can be estimated. */
  updateLocation(
    id: string,
    lat: number,
    lng: number,
    estimatedArrivalAt?: Date,
  ): Promise<DeliveryRecord>;
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
