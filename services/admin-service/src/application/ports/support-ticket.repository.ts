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

export interface SupportTicketRepository {
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
