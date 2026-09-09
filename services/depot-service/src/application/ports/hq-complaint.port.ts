/**
 * CA-2-58 — the depot's end of a customer complaint, mirrored to head office.
 *
 * A complaint used to be recorded in two systems that never saw each other: an HQ support
 * ticket, and a `CUSTOMER_CONFLICT` row in this service's incident inbox. Nothing linked
 * them, so a complaint taken at the depot counter was invisible upstairs and the customer's
 * follow-up depended on whoever happened to be standing there.
 */
export interface HqComplaint {
  depotId: string;
  /** Who complained, as the operator wrote it — very often not an account. */
  customerRef: string;
  /** The number head office would call back on. Without it there is no ticket to open. */
  customerPhone: string;
  subject: string;
  body: string;
  orderRef?: string | null;
}

export interface HqComplaintPort {
  /**
   * Open the HQ ticket for this complaint and return its id.
   *
   * Returns null when the mirror did not happen — head office unreachable, or the internal
   * key not configured. The incident itself is already saved either way: refusing to record
   * a depot's own complaint because head office was down would lose the one copy that is
   * certainly wanted. The null is stored, so an unmirrored complaint is visible AS
   * unmirrored rather than silently indistinguishable from one nobody sent.
   */
  open(complaint: HqComplaint): Promise<string | null>;
}
