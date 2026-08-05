import {
  Announcement,
  AnnouncementDimension,
  AnnouncementLevel,
  AnnouncementRead,
  AnnouncementTarget,
} from '../../../prisma/generated/client';

export const ANNOUNCEMENT_REPOSITORY = Symbol('ANNOUNCEMENT_REPOSITORY');

export interface AnnouncementTargetWrite {
  dimension: AnnouncementDimension;
  value: string | null;
}

export interface AnnouncementWrite {
  title: string;
  body: string;
  level: AnnouncementLevel;
  scheduledAt: Date | null;
  createdBy: string | null;
}

export interface AnnouncementListFilter {
  /** Only the ones already out. The console's history tab wants drafts too. */
  publishedOnly?: boolean;
  skip: number;
  take: number;
}

export type AnnouncementWithTargets = Announcement & { targets: AnnouncementTarget[] };

/** The employee fields an audience rule can match on — mirrors domain/announcement.ts. */
export interface FeedAudience {
  employeeId: string;
  depotId: string | null;
  departmentId: string | null;
  position: string;
}

export interface AnnouncementRepository {
  create(
    data: AnnouncementWrite,
    targets: AnnouncementTargetWrite[],
  ): Promise<AnnouncementWithTargets>;
  findById(id: string): Promise<AnnouncementWithTargets | null>;
  list(filter: AnnouncementListFilter): Promise<{ rows: AnnouncementWithTargets[]; total: number }>;
  /**
   * One employee's feed: published notices whose audience covers them, newest first.
   *
   * H-18: this used to be `listPublished(limit)` — the newest 50 notices company-wide,
   * filtered by audience in JS afterwards. With several depots publishing, a depot's own
   * notice is pushed out of that global window by other depots' traffic, and the employee
   * it was addressed to simply never sees it. The audience predicate belongs in the
   * query, so `limit` bounds THEIR feed instead of everyone's.
   */
  listFeedFor(audience: FeedAudience, limit: number): Promise<AnnouncementWithTargets[]>;
  /** Scheduled, not yet published, due at or before `now`. The sweep's work list. */
  listDue(now: Date): Promise<AnnouncementWithTargets[]>;
  /** Stamp it live with the audience size frozen in. */
  markPublished(id: string, publishedAt: Date, audienceSize: number): Promise<Announcement>;
  /** Idempotent: marking read twice is still one read. */
  markRead(announcementId: string, employeeId: string): Promise<AnnouncementRead>;
  countReads(announcementId: string): Promise<number>;
  listReadIdsFor(employeeId: string, announcementIds: string[]): Promise<string[]>;
}
