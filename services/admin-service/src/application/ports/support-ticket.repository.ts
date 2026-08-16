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
  priority?: TicketPriority;
  /** The complaint itself — a ticket with no first message is a subject line. */
  body: string;
}

export interface SupportTicketRepository {
  /** Open a ticket with its first (customer) message. */
  create(data: CreateSupportTicketData): Promise<SupportTicketRecord>;
  /** Tickets (newest-first), optionally filtered, each with its message thread. */
  list(filter: ListSupportTicketsFilter): Promise<SupportTicketRecord[]>;
  findById(id: string): Promise<SupportTicketRecord | null>;
  /** Append a STAFF reply. Returns the refreshed ticket, or null when unknown. */
  addStaffMessage(id: string, body: string): Promise<SupportTicketRecord | null>;
  /** Assign to a staff id (moves OPEN → ASSIGNED). Null when unknown. */
  assign(id: string, assigneeId: string): Promise<SupportTicketRecord | null>;
  /** Mark RESOLVED. Null when unknown. */
  resolve(id: string): Promise<SupportTicketRecord | null>;
}
