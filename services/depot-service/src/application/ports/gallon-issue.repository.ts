// Gallon-issue domain vocabulary (PRD Module 11c). The mirror of retur galon: empties
// handed OUT on deposit. Issues carry no condition (nothing to grade on the way out), so
// — unlike gallon-return — there is no enum; the record shape lives here, with its port.
//
// ponytail: manual ledger only. Auto-ingesting issues from an order-completed event
// (order-service coupling) is a deliberate follow-up, not built here.
//
// Q-3: this comment used to live in src/domain/gallon-issue.ts, a file whose entire
// runtime content was `export {}` — a doc comment nothing imported, so nobody read it
// where it mattered. The prose moved here; the module is gone.
export interface GallonIssueRecord {
  id: string;
  depotId: string;
  customerId: string | null;
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

export interface GallonIssueDepotRow {
  depotId: string;
  gallons: number;
  depositHeld: number;
}

export interface GallonIssueRepository {
  create(data: CreateGallonIssueData): Promise<GallonIssueRecord>;
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
}
