// Campaign lifecycle (PRD Module 12 FR-088 Broadcast Campaign). DRAFT until dispatched,
// SENDING while recipients are processed, SENT once complete.

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  SENDING = 'SENDING',
  SENT = 'SENT',
}

/** Only a DRAFT campaign may be dispatched. Guards against re-sending a SENT/SENDING one. */
export function canSend(status: CampaignStatus): boolean {
  return status === CampaignStatus.DRAFT;
}
