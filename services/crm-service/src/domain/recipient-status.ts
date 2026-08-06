// Per-recipient delivery state within a campaign send (PRD Module 12 FR-094). PENDING until
// the broadcast runs, then SENT or FAILED depending on the WhatsApp result.
//
// B-17: SENDING exists because the broadcast is now a resumable background sweep rather
// than a loop inside the HTTP request. A sweep CLAIMS a batch by moving it PENDING ->
// SENDING in one conditional write, so a second sweep tick cannot pick up the same
// recipients and message a real customer twice. The recipient rows ARE the queue — this
// is the per-row status the plan means by "DB cursor, no Redis/BullMQ".

export enum RecipientStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}
