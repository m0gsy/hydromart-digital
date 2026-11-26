import { DepotDraftContent, DepotDraftRecord } from '../../domain/depot-draft';

export interface NewDepotDraft extends DepotDraftContent {
  prospectId: string;
  requestHash: string;
  suggestionId: string;
  createdBy: string;
}

export interface DepotDraftRepository {
  findByProspectId(prospectId: string): Promise<DepotDraftRecord | null>;
  /** One row per prospect: a second insert for the same prospect throws Prisma's P2002. */
  create(data: NewDepotDraft): Promise<DepotDraftRecord>;
  /**
   * Reopen a REJECTED draft as DRAFT with new content, clearing the decision. Only lands while
   * the row is still REJECTED; returns null when it no longer is (somebody else got there first).
   */
  reopen(id: string, data: NewDepotDraft): Promise<DepotDraftRecord | null>;
}
