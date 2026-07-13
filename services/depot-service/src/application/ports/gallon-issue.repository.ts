export interface GallonIssueRecord {
  id: string;
  depotId: string;
  customerId: string | null;
  quantity: number;
  depositHeld: number;
  note: string | null;
  actorId: string;
  createdAt: Date;
}

export interface CreateGallonIssueData {
  depotId: string;
  customerId: string | null;
  quantity: number;
  depositHeld: number;
  note: string | null;
  actorId: string;
}

/** Rollup of a depot's issues (all time): empties handed out + deposit held. */
export interface GallonIssueSummary {
  issues: number;
  gallons: number;
  depositHeld: number;
}

export interface GallonIssueRepository {
  create(data: CreateGallonIssueData): Promise<GallonIssueRecord>;
  listForDepot(depotId: string, page: number, limit: number): Promise<{ items: GallonIssueRecord[]; total: number }>;
  summaryForDepot(depotId: string): Promise<GallonIssueSummary>;
}
