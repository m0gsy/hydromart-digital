import { DeliveryStatus } from '../../domain/delivery-status';
import { ContactMethod, ContactState } from '../../domain/no-show';

export interface ProofRecord {
  photoUrl: string;
  signatureUrl: string | null;
  /**
   * K2.8: what the courier answered about the gallon seal, or NULL if nobody was asked.
   *
   * Three values, three meanings, and the third is the reason this is nullable: `true` and
   * `false` are testimony, NULL is its absence. Every proof written before the column, and
   * every old APK still in somebody's hand, lands in NULL — and defaulting those to `true`
   * would manufacture evidence nobody gave.
   */
  sealIntact: boolean | null;
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
  /**
   * Snapshotted at assignment. OPTIONAL rather than nullable-required: a row written before
   * the column existed has no owner recorded, and the field being absent says that more
   * honestly than a null every fixture has to spell out.
   */
  customerId?: string | null;
  items: DeliveryItem[] | null;
  codAmount: number | null;
  notes: string | null;
  deliveryWindow: string | null;
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

/**
 * J8. The four fields a breach decision needs, and nothing else — the full DeliveryRecord
 * drags the proof and the whole status history along for a row the sweep only reads a
 * timestamp off (audit Q-13, same reason `DeliveryPingState` exists).
 */
export interface SlaCandidate {
  id: string;
  orderNumber: string;
  depotId: string | null;
  assignedAt: Date;
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
  customerId?: string | null;
  items: DeliveryItem[] | null;
  codAmount: number | null;
  notes: string | null;
  /*
   * B5. Optional, like `customerId` above and for the same reason: a delivery created
   * before the column existed carries no window, and the field being absent says that more
   * honestly than a null every fixture has to spell out.
   */
  deliveryWindow?: string | null;
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
  depotIds?: readonly string[];
  status?: DeliveryStatus;
  page: number;
  limit: number;
  /**
   * Opaque keyset cursor — the previous page's `nextCursor`. Seeks straight to that row
   * instead of walking every row before it (audit Q-16); `page` is ignored when set.
   */
  cursor?: string;
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

/** The projection behind `findPingState` — no history, no proof. */
export interface DeliveryPingState {
  id: string;
  driverId: string | null;
  status: DeliveryStatus;
  depotId: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  lastLat: number | null;
  lastLng: number | null;
}

/**
 * One order a courier may be holding cash for in a settlement window: its id, the COD
 * written at assignment, and how the delivery ENDED.
 *
 * CA-4-03: the status is here because the expectation is not symmetric. A DELIVERED order
 * owes its COD whether or not the courier remembered to press "Terima uang" — the goods
 * left the van. A FAILED or RESCHEDULED one owes nothing by default, because nothing was
 * handed over; it owes exactly the cash payment-service says was actually PAID, and no
 * more. Reading `codAmount` on those would invent a debt out of a delivery that never
 * happened.
 */
export interface CodBearing {
  orderId: string;
  codAmount: number | null;
  status: DeliveryStatus;
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
  search(
    query: DeliveryQuery,
  ): Promise<{ items: DeliveryRecord[]; total: number; nextCursor: string | null }>;
  /**
   * Orders the driver DELIVERED with `deliveredAt` in [from, to] — the orders a shift's
   * COD settlement is computed over. Every delivered order, cash or not.
   *
   * C1: carries `codAmount` as well as the id. Proof of delivery never marks the payment
   * PAID, so payment-service alone answers zero for a courier who collected the cash and
   * skipped "Terima uang" — and the settlement then expected nothing. The COD written on
   * the delivery row at assignment is the half of the answer that survives that.
   *
   * CA-4-03: this used to select `status = DELIVERED` only, and that is where collected
   * money went missing. A courier can take the cash at the door and then mark the delivery
   * Gagal (wrong goods, a dispute) or Jadwal-ulang — both are reachable from ON_DELIVERY —
   * and the row then failed the filter entirely. The cash was real, it was in the courier's
   * pocket, and the end-of-shift expectation did not mention it: no shortfall, no dispute,
   * no trace. Now every delivery the courier CLOSED in this window is returned, whatever it
   * closed as, and the caller decides what each one owes.
   *
   * "Closed in this window" is read from the timestamp each ending actually writes:
   * `deliveredAt` for DELIVERED, `failedAt` for FAILED, and the status-history row for
   * RESCHEDULED — which has no completion column of its own (`rescheduledFor` is the FUTURE
   * slot, not when the courier gave it back).
   */
  codBearingInWindow(driverId: string, from: Date, to: Date): Promise<CodBearing[]>;
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
  /**
   * Just enough of a delivery to accept a GPS ping: who owns it, whether it is still
   * moving, and the coordinates the ETA is computed from (audit S-17). A ping used to read
   * the whole row — the full status history and the delivery proof — every few seconds,
   * per courier on the road, only to check a driver id and a status.
   */
  findPingState(id: string): Promise<DeliveryPingState | null>;
  /** Overwrite the latest driver position and refresh ETA when one can be estimated. */
  updateLocation(
    id: string,
    lat: number,
    lng: number,
    estimatedArrivalAt?: Date,
  ): Promise<DeliveryRecord>;
  /**
   * Move the delivery to `status`, set the matching timestamp, append history — but only
   * from the `from` the caller read it at (H-5).
   *
   * The legality check runs against a snapshot. Without the compare-and-set two taps on a
   * courier's phone, or a driver and a dispatcher acting together, both pass it and both
   * write; the loser now gets StaleDeliveryStatusError instead of overwriting.
   */
  applyStatus(
    id: string,
    from: DeliveryStatus,
    status: DeliveryStatus,
    timestamps: DeliveryTimestamps,
    changedBy: string | null,
    note: string | null,
  ): Promise<DeliveryRecord>;
  /**
   * Puts a RESCHEDULED delivery back to ASSIGNED for a second attempt, possibly with a
   * different driver. One row per order (orderId is unique), so the retry reuses it.
   */
  reassign(id: string, driverId: string, changedBy: string, note: string | null): Promise<DeliveryRecord>;
  /**
   * Record proof of delivery and mark the delivery DELIVERED atomically, from `from` only.
   *
   * The guard is what stops a re-tapped Selesai paying the courier for one handover twice
   * (H-5); the proof row and the status move together so neither can exist without the
   * other (H-8).
   */
  completeWithProof(
    id: string,
    from: DeliveryStatus,
    proof: Omit<ProofRecord, 'capturedAt'>,
    changedBy: string,
    /** Handover time — server time for a live proof, clamped device time for an offline one. */
    capturedAt: Date,
  ): Promise<DeliveryRecord>;
  /**
   * UU PDP retention: delete proof-of-delivery rows (photo/signature URL, recipient name,
   * GPS) captured before `cutoff`, and return every URL they held so the objects go too.
   */
  purgeProofsBefore(cutoff: Date): Promise<{ count: number; urls: string[] }>;
  /**
   * UU PDP item 13: forget one person, now rather than when a window expires.
   *
   * `docs/AUDIT_L3.md` §4.2 measured what "when the window expires" left standing here:
   * 153 rows in `deliveries.recipientPhone` with no window at all, and 76 recipient names
   * on proofs that DO have one — 365 days, which means the row disappears some day, not the
   * day the person asked.
   *
   * Scrub, not delete. A delivery is the other half of an order, and orders are FINANCIAL
   * (ten years, written into the erasure registry's exemptions); deleting the delivery
   * would leave an order nobody can explain. What goes is the person: the recipient's phone
   * on the delivery, the recipient's name on the proof. The proof PHOTO stays until its own
   * 365-day sweep — the objects are the retention executor's job and it already deletes
   * them, and racing it from here would leave rows pointing at nothing.
   *
   * Idempotent: a retry rewrites the same blanks and reports the same count.
   */
  erasePerson(customerId: string, phone: string | null): Promise<number>;
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
  /**
   * J8. Deliveries still on the road (ASSIGNED/PICKED_UP/ON_DELIVERY) that were assigned
   * before `assignedBefore` and have not had their breach reported yet.
   *
   * `assignedBefore` is a COARSE filter — the SLA window is per-depot, so this cannot
   * decide a breach, only narrow the set the caller has to look at. The caller applies
   * that depot's own threshold. Bounded by `limit`: a sweep must not be able to load an
   * unbounded backlog into memory the first time it runs against a real book.
   */
  findUnalertedInFlight(assignedBefore: Date, limit: number): Promise<SlaCandidate[]>;
  /**
   * J8. Stamp `slaAlertedAt` so the next sweep skips this delivery. Only ever called
   * after the alert actually reached ops, which is what makes the sweep retry rather
   * than lose a breach when crm is down.
   */
  markSlaAlerted(id: string, at: Date): Promise<void>;
}
