export interface CampaignTotals {
  /** Campaigns that finished sending (SENT or COMPLETED_WITH_FAILURES) inside the window, by the instant they finished. */
  campaigns: number;
  /** Their recipient rows by outcome: reached (the in-app inbox), failed, skipped (opted out), and any other state. */
  sent: number;
  failed: number;
  skipped: number;
  other: number;
}

/** HD-6 H4 part 2: the campaign facts of O-09. */
export interface AiCampaignRepository {
  /** `[from, to)` by the instant each campaign finished. */
  totals(from: Date, to: Date): Promise<CampaignTotals>;
}

export const AI_CAMPAIGN_REPOSITORY = Symbol('AiCampaignRepository');
