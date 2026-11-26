import { FollowUpStatus, Visit, VisitItem, VisitItemResult, VisitStatus } from '../../domain/visit';

export interface NewVisitItem {
  position: number;
  text: string;
  sopId: string | null;
  sopVersionId: string | null;
  sopVersionNo: number | null;
  sopTitle: string | null;
}

export interface NewVisit {
  depotId: string;
  templateId: string;
  templateName: string;
  visitorId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  distanceM: number | null;
  approximateFix: boolean;
  fenceChecked: boolean;
  items: NewVisitItem[];
}

export interface ItemAnswer {
  result: VisitItemResult;
  findingNote: string | null;
  photoKey: string | null;
  /** WIB day key. */
  followUpDueOn: string | null;
  followUpStatus: FollowUpStatus | null;
}

/** `depotIds` undefined = every depot (head office); an array = only those. */
export interface VisitListQuery {
  depotIds?: readonly string[];
  status?: VisitStatus;
  page: number;
  pageSize: number;
}

export type VisitSummary = Omit<Visit, 'items'> & { itemCount: number; findingCount: number };

export type FindingState = 'open' | 'overdue' | 'done';

export interface FindingQuery {
  depotIds?: readonly string[];
  state?: FindingState;
  /** WIB day key of today, for the overdue cut. */
  todayKey: string;
  page: number;
  pageSize: number;
}

export interface DepotVisitStat {
  depotId: string;
  lastVisitAt: Date | null;
  visitsLast30d: number;
  /** Visits in the last 30 days made where the fence was off (radius 0): recorded, never checked. */
  unfencedVisitsLast30d: number;
  openFindings: number;
  overdueFollowUps: number;
}

export interface VisitRepository {
  /** Creates the visit with its copied lines; a second open visit by the same person at the same depot throws VisitAlreadyOpenError. */
  create(data: NewVisit): Promise<Visit>;
  findOpenOf(visitorId: string): Promise<Visit[]>;
  /** Counts one photo against an open visit's cap; false when the cap is reached or the visit is not open. */
  reserveUpload(visitId: string, max: number): Promise<boolean>;
  /** Gives a reserved slot back after a failed put. */
  releaseUpload(visitId: string): Promise<void>;
  findById(id: string): Promise<Visit | null>;
  findItem(itemId: string): Promise<VisitItem | null>;
  /** Writes one line's answer, only while its visit is still IN_PROGRESS; null when it is not. */
  answerItem(visitId: string, itemId: string, answer: ItemAnswer): Promise<VisitItem | null>;
  /** COMPLETED only from IN_PROGRESS and with nothing PENDING (checked in the same write); null when it did not apply. */
  complete(id: string, now: Date): Promise<Visit | null>;
  list(query: VisitListQuery): Promise<{ items: VisitSummary[]; total: number }>;
  findings(query: FindingQuery): Promise<{ items: VisitItem[]; total: number }>;
  overview(
    depotIds: readonly string[] | undefined,
    since: Date,
    todayKey: string,
  ): Promise<DepotVisitStat[]>;
  /** Marks a finding's follow-up done; an already DONE one is returned untouched. Null when the line is not an open finding. */
  closeFollowUp(itemId: string, by: string, note: string | null, now: Date): Promise<VisitItem | null>;
  /** Open follow-ups past their WIB deadline, in total and per depot (the sweep, PR-6 notifies). */
  overdueCounts(todayKey: string): Promise<{ depots: number; items: number }>;
}
