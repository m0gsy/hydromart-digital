import { Checklist, FranchiseAppStage } from '../../domain/franchise-application';

export interface FranchiseApplicationRecord {
  id: string;
  applicantName: string;
  applicantPhone: string;
  proposedCode: string;
  proposedName: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  investmentAmount: number;
  projectedMonthlyRevenue: number;
  checklist: Checklist;
  stage: FranchiseAppStage;
  /** The reason HQ gave when approving/rejecting (trimmed, <= 300 chars), if any. */
  decisionReason: string | null;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFranchiseApplicationData {
  applicantName: string;
  applicantPhone: string;
  proposedCode: string;
  proposedName: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  investmentAmount: number;
  projectedMonthlyRevenue: number;
  checklist: Checklist;
  stage?: FranchiseAppStage;
}

export interface UpdateFranchiseApplicationData {
  stage?: FranchiseAppStage;
  checklist?: Checklist;
  decisionReason?: string | null;
}

export interface ListApplicationsFilter {
  page: number;
  limit: number;
  stage?: FranchiseAppStage;
}

export interface FranchiseApplicationRepository {
  create(data: CreateFranchiseApplicationData): Promise<FranchiseApplicationRecord>;
  /** Queue read: oldest-first by submittedAt (highest SLA age first). */
  list(
    filter: ListApplicationsFilter,
  ): Promise<{ items: FranchiseApplicationRecord[]; total: number }>;
  findById(id: string): Promise<FranchiseApplicationRecord | null>;
  /**
   * Writes `patch` — but only while the application is still undecided, and, when
   * `seenUpdatedAt` is given, only if it is still the row that was read. Null when either
   * no longer holds.
   *
   * The service checks "is it decided" with a read, so an approve and a reject could both pass
   * it and both write (the later one winning, with both in the audit trail), and a checklist
   * PATCH could overwrite a decision that landed a moment earlier. The checklist is merged from
   * a read too; pinning it to `updatedAt` is what stops two concurrent edits losing one.
   */
  updateIfOpen(
    id: string,
    patch: UpdateFranchiseApplicationData,
    seenUpdatedAt?: Date,
  ): Promise<FranchiseApplicationRecord | null>;
  /**
   * CA-3-53 — retention. Delete REJECTED applications decided before `cutoff`.
   *
   * REJECTED only. An approved application became a depot, and its row is the paper trail
   * of how that depot came to exist. A pending one has not been decided at all, so no
   * clock has started on it.
   *
   * `updatedAt` stands in for a decision date: the last write to a rejected row IS its
   * rejection, and adding a `decidedAt` column would be a migration whose writer could not
   * ship in the same release.
   */
  purgeRejectedBefore(cutoff: Date): Promise<number>;
}
