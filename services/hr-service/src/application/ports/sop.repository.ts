import { Sop, SopVersion } from '../../../prisma/generated/client';

export const SOP_REPOSITORY = Symbol('SOP_REPOSITORY');

export type SopVersionWithDepots = SopVersion & { depots: { depotId: string }[] };
export type SopWithVersions = Sop & { versions: SopVersionWithDepots[] };

export interface SopVersionWrite {
  title: string;
  body: string | null;
  fileKey: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  effectiveFrom: Date;
  allDepots: boolean;
  depotIds: string[];
  audienceSize: number;
  publishedBy: string | null;
}

export interface SopRepository {
  /** The SOP and its version 1, in one write. */
  create(title: string, createdBy: string | null, version: SopVersionWrite): Promise<SopWithVersions>;
  /**
   * The next version number is read and written in one transaction; (sopId, versionNo) is
   * unique, so two writers racing for the same number cannot both win — the loser throws
   * P2002 and the service retries once. Null = no such SOP.
   */
  addVersion(sopId: string, version: SopVersionWrite): Promise<SopVersionWithDepots | null>;
  findById(id: string): Promise<SopWithVersions | null>;
  /** Every SOP, versions newest first. HQ keeps tens of these, not thousands. */
  list(): Promise<SopWithVersions[]>;
  findVersion(versionId: string): Promise<(SopVersionWithDepots & { sop: Sop }) | null>;
  /** Versions of the given SOPs, for the in-force lookup. */
  listVersions(sopIds: readonly string[]): Promise<(SopVersionWithDepots & { sop: Sop })[]>;
  /** versionId -> how many employees acknowledged it. */
  countAcks(versionIds: readonly string[]): Promise<Map<string, number>>;
  listAckedEmployeeIds(versionId: string): Promise<string[]>;
}
