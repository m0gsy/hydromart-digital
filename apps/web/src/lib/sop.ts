// HD-16 — what hr-service answers on /sops (mirrors services/hr-service sop.service.ts views).

export interface SopVersion {
  id: string;
  versionNo: number;
  title: string;
  /** A WIB day, YYYY-MM-DD. */
  effectiveFrom: string;
  allDepots: boolean;
  depotIds: string[];
  hasFile: boolean;
  fileName: string | null;
  sizeBytes: number | null;
  audienceSize: number;
  ackCount: number;
  unread: number;
  createdAt: string;
}

export interface SopVersionDetail extends SopVersion {
  body: string | null;
}

export interface SopSummary {
  id: string;
  title: string;
  createdAt: string;
  versionCount: number;
  current: SopVersion | null;
  upcoming: SopVersion | null;
}

export interface SopDetail {
  id: string;
  title: string;
  createdAt: string;
  versions: SopVersionDetail[];
}

export interface SopUnreadPage {
  versionId: string;
  versionNo: number;
  audienceSize: number;
  ackCount: number;
  unreadTotal: number;
  byDepot: { depotId: string | null; unread: number }[];
  page: number;
  pageSize: number;
  items: { employeeId: string; employeeCode: string; fullName: string; position: string; depotId: string | null }[];
}

export interface SopUpload {
  fileKey: string;
  fileName: string;
  sizeBytes: number;
}

/** What the version form sends (POST /sops adds `title`). */
export interface SopVersionBody {
  versionTitle?: string;
  body?: string;
  fileKey?: string;
  fileName?: string;
  sizeBytes?: number;
  effectiveFrom: string;
  allDepots: boolean;
  depotIds?: string[];
}

/** "Semua depot" or "N depot" — the audience of one version, in the words the screen uses. */
export function audienceLabel(v: Pick<SopVersion, 'allDepots' | 'depotIds'>, t: (k: string, vars?: Record<string, string | number>) => string): string {
  return v.allDepots ? t('hq.sop.allDepots') : t('hq.sop.depotCount', { n: v.depotIds.length });
}
