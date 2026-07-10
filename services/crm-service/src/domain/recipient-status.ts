// Per-recipient delivery state within a campaign send (PRD Module 12 FR-094). PENDING until
// the broadcast runs, then SENT or FAILED depending on the WhatsApp result.

export enum RecipientStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}
