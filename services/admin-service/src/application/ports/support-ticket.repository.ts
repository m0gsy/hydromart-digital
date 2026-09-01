import { TicketAuthorType, TicketPriority, TicketStatus } from '../../domain/ticket';

export interface TicketMessageRecord {
  id: string;
  ticketId: string;
  authorType: TicketAuthorType;
  body: string;
  createdAt: Date;
}

export interface SupportTicketRecord {
  id: string;
  subject: string;
  customerRef: string;
  customerPhone: string;
  orderRef: string | null;
  /** K1.5: the account that raised it, or null for one staff typed at the counter. */
  customerId: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeId: string | null;
  createdAt: Date;
  messages: TicketMessageRecord[];
}

export interface ListSupportTicketsFilter {
  status?: TicketStatus;
  priority?: TicketPriority;
}

/**
 * A ticket raised at the counter or on the phone, with the complaint as its first message.
 *
 * Audit: `/hq/tickets` could list, reply, assign and resolve — but nothing anywhere could
 * CREATE one, so the table only ever held rows put there by hand. `authorType` on that first
 * message is CUSTOMER: staff are typing down what the customer said, and a thread whose
 * opening line is attributed to staff reads as the depot complaining to itself.
 */
export interface CreateSupportTicketData {
  subject: string;
  customerRef: string;
  customerPhone: string;
  orderRef?: string | null;
  /**
   * K1.5: the account that raised this, when one did. Null for a ticket staff typed at the
   * counter — `customerRef` is free text precisely because that person often has no
   * account. This is what lets somebody who DOES have one see their own again.
   */
  customerId?: string | null;
  priority?: TicketPriority;
  /** The complaint itself — a ticket with no first message is a subject line. */
  body: string;
}

export interface SupportTicketRepository {
  /** Open a ticket with its first (customer) message. */
  create(data: CreateSupportTicketData): Promise<SupportTicketRecord>;
  /** Tickets (newest-first), optionally filtered, each with its message thread. */
  list(filter: ListSupportTicketsFilter): Promise<SupportTicketRecord[]>;
  /**
   * K1.5: one customer's OWN tickets, newest first, with their threads.
   *
   * Scoped by `customerId` and nothing else. Matching on phone number would hand somebody
   * every complaint ever filed from a number they now hold.
   */
  listForCustomer(customerId: string, limit: number): Promise<SupportTicketRecord[]>;
  findById(id: string): Promise<SupportTicketRecord | null>;
  /** Append a STAFF reply. Returns the refreshed ticket, or null when unknown. */
  addStaffMessage(id: string, body: string): Promise<SupportTicketRecord | null>;
  /** Assign to a staff id (moves OPEN → ASSIGNED). Null when unknown. */
  assign(id: string, assigneeId: string): Promise<SupportTicketRecord | null>;
  /** Mark RESOLVED. Null when unknown. */
  resolve(id: string): Promise<SupportTicketRecord | null>;
  /**
   * UU PDP item 13: forget one person's complaints.
   *
   * `docs/AUDIT_L3.md` §4.2 counted 14 tickets holding `customerPhone`, plus the free text
   * in `ticket_messages` — a queue whose whole workflow is phoning whoever is on the row.
   * Neither table has a retention policy at all, so nothing would ever have removed them.
   *
   * Scrub, not delete: the ticket is also the record that somebody complained and how it
   * was resolved, which is an operational fact about the depot rather than about the
   * person. What goes is the person — the phone, the free-text reference, and the customer
   * messages' bodies. Staff replies stay: they are the depot's own words.
   *
   * Matched on id OR phone, because a ticket staff opened at the counter has a phone and
   * no id (see the `customerId` note on the model). Idempotent.
   */
  erasePerson(customerId: string, phone: string | null): Promise<number>;
}
