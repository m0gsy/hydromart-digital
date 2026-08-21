// Gallon-issue domain vocabulary (PRD Module 11c). The mirror of retur galon: empties
// handed OUT on deposit. Issues carry no condition (nothing to grade on the way out), so
// — unlike gallon-return — there is no enum; the record shape lives here, with its port.
//
// I1: the follow-up the note below promised is now built. Fulfilment writes this ledger
// through `createFromOrder`, keyed on `orderId` so an at-least-once completion fan-out
// cannot book the same deposit twice. Before that, the ledger was written by nobody but
// the manual returns screen, `depositHeld` was 0 for every depot in production, and every
// courier return therefore refunded Rp0 and queued a manager approval.
//
// Q-3: this comment used to live in src/domain/gallon-issue.ts, a file whose entire
// runtime content was `export {}` — a doc comment nothing imported, so nobody read it
// where it mattered. The prose moved here; the module is gone.
export interface GallonIssueRecord {
  id: string;
  depotId: string;
  customerId: string | null;
  /** I1: the order fulfilment booked this issue from. Null for a staff-entered row. */
  orderId: string | null;
  quantity: number;
  depositHeld: number;
  note: string | null;
  actorId: string;
  createdAt: Date;
}

export interface CreateGallonIssueData {
  depotId: string;
  customerId: string | null;
  quantity: number;
  depositHeld: number;
  note: string | null;
  actorId: string;
}

/** I1: one delivery's worth of empties, booked from the order that carried them out. */
export interface CreateGallonIssueFromOrderData extends CreateGallonIssueData {
  orderId: string;
}

/** Rollup of a depot's issues (all time): empties handed out + deposit held. */
export interface GallonIssueSummary {
  issues: number;
  gallons: number;
  depositHeld: number;
}

/** One depot's all-time issue totals (network rollup). */
/** One customer's issue (or return) totals at one depot. */
export interface GallonCustomerRow {
  customerId: string;
  gallons: number;
  amountIdr: number;
}

/**
 * I2: one named customer's side of one ledger at one depot. `amountIdr` is deposit HELD on
 * the issue ledger and deposit REFUNDED on the return ledger — the same asymmetry
 * `GallonCustomerRow` already carries, kept so the two can be subtracted directly.
 */
export interface GallonCustomerBalance {
  gallons: number;
  amountIdr: number;
}

export interface GallonIssueDepotRow {
  depotId: string;
  gallons: number;
  depositHeld: number;
}

export interface GallonIssueRepository {
  create(data: CreateGallonIssueData): Promise<GallonIssueRecord>;
  /**
   * I1: idempotent on `orderId`. A completion fan-out is at-least-once, so this WILL be
   * called twice for the same order; the second call must return the row the first wrote
   * rather than book a second deposit — which would inflate what the depot appears to hold
   * and therefore what it later refunds.
   */
  createFromOrder(data: CreateGallonIssueFromOrderData): Promise<GallonIssueRecord>;
  listForDepot(
    depotId: string,
    page: number,
    limit: number,
  ): Promise<{ items: GallonIssueRecord[]; total: number }>;
  summaryForDepot(depotId: string): Promise<GallonIssueSummary>;
  /** Per-depot issue totals across the network (SUM quantity, depositHeld). */
  networkSummary(): Promise<GallonIssueDepotRow[]>;
  /**
   * Issue totals per CUSTOMER at one depot (J-2). Rows with no customer are excluded —
   * an anonymous counter issue is not a person anybody can chase for a gallon back.
   */
  perCustomerForDepot(depotId: string): Promise<GallonCustomerRow[]>;
  /**
   * I2: one customer's totals at one depot. `perCustomerForDepot` would answer this too,
   * but it reads every customer of the depot to serve one return — this is the targeted
   * read the cap needs on the hot path.
   */
  summaryForCustomerAtDepot(depotId: string, customerId: string): Promise<GallonCustomerBalance>;
  /** One customer's most recent issues at one depot — the CRM detail deposit ledger. */
  listForCustomerAtDepot(
    depotId: string,
    customerId: string,
    limit: number,
  ): Promise<GallonIssueRecord[]>;
}
