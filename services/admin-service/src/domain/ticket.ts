// Support-ticket lifecycle (Design 15a). Mirrors the Prisma TicketPriority / TicketStatus /
// TicketAuthorType enums but stays domain-local so application/domain code never imports the
// generated client.

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum TicketStatus {
  OPEN = 'OPEN',
  ASSIGNED = 'ASSIGNED',
  RESOLVED = 'RESOLVED',
}

/// Who wrote a ticket message.
export enum TicketAuthorType {
  CUSTOMER = 'CUSTOMER',
  STAFF = 'STAFF',
}
