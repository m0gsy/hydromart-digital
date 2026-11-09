// Campaign lifecycle (PRD Module 12 FR-088 Broadcast Campaign). DRAFT until dispatched,
// SENDING while recipients are processed, SENT once complete.

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  SENDING = 'SENDING',
  SENT = 'SENT',
  /** CRM-02: finished, but somebody failed or nobody was reached. */
  COMPLETED_WITH_FAILURES = 'COMPLETED_WITH_FAILURES',
  /** CRM-04: stopped by staff before it finished. */
  CANCELLED = 'CANCELLED',
}

/** Only a DRAFT campaign may be dispatched. Guards against re-sending a SENT/SENDING one. */
/** CRM-04: a campaign can be stopped until it has finished. */
export function canCancel(status: CampaignStatus): boolean {
  return status === CampaignStatus.DRAFT || status === CampaignStatus.SENDING;
}

export function canSend(status: CampaignStatus): boolean {
  return status === CampaignStatus.DRAFT;
}
