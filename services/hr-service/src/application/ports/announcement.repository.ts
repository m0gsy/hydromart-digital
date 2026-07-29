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

export interface AnnouncementRepository {
  create(
    data: AnnouncementWrite,
    targets: AnnouncementTargetWrite[],
  ): Promise<AnnouncementWithTargets>;
  findById(id: string): Promise<AnnouncementWithTargets | null>;
  list(filter: AnnouncementListFilter): Promise<{ rows: AnnouncementWithTargets[]; total: number }>;
  /** Everything already visible, newest first — the source for one employee's feed. */
  listPublished(limit: number): Promise<AnnouncementWithTargets[]>;
  /** Scheduled, not yet published, due at or before `now`. The sweep's work list. */
  listDue(now: Date): Promise<AnnouncementWithTargets[]>;
  /** Stamp it live with the audience size frozen in. */
  markPublished(id: string, publishedAt: Date, audienceSize: number): Promise<Announcement>;
  /** Idempotent: marking read twice is still one read. */
  markRead(announcementId: string, employeeId: string): Promise<AnnouncementRead>;
  countReads(announcementId: string): Promise<number>;
  listReadIdsFor(employeeId: string, announcementIds: string[]): Promise<string[]>;
}
