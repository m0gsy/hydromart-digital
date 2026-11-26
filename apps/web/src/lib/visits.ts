// HD-15B PR-5 — what depot-service answers on /visits (mirrors the Visit*ResponseDto shapes).

export type VisitItemResult = 'PENDING' | 'PASS' | 'FINDING';

export interface VisitItem {
  id: string;
  visitId: string;
  depotId: string;
  position: number;
  text: string;
  sopVersionId: string | null;
  sopVersionNo: number | null;
  sopTitle: string | null;
  result: VisitItemResult;
  findingNote: string | null;
  /** A link that expires in minutes, or null. */
  photoUrl: string | null;
  /** A WIB day, YYYY-MM-DD. */
  followUpDueOn: string | null;
  followUpStatus: 'OPEN' | 'DONE' | null;
  followUpDoneAt: string | null;
  followUpNote: string | null;
}

export interface VisitSummary {
  id: string;
  depotId: string;
  templateName: string;
  visitorId: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  checkInAt: string;
  completedAt: string | null;
  itemCount: number;
  findingCount: number;
}

export interface Visit extends Omit<VisitSummary, 'itemCount' | 'findingCount'> {
  fenceChecked: boolean;
  approximateFix: boolean;
  items: VisitItem[];
}

export interface DepotOverview {
  depotId: string;
  depotName: string;
  lastVisitAt: string | null;
  visitsLast30d: number;
  unfencedVisitsLast30d: number;
  openFindings: number;
  overdueFollowUps: number;
}

export interface VisitOverview {
  depots: DepotOverview[];
  truncated: boolean;
}

export interface VisitPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type FindingState = 'open' | 'overdue' | 'done';
