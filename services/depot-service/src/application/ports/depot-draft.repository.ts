import { DepotDraftContent, DepotDraftRecord, DepotDraftStatus } from '../../domain/depot-draft';
import { CreateDepotData } from './depot.repository';

export interface NewDepotDraft extends DepotDraftContent {
  prospectId: string;
  requestHash: string;
  suggestionId: string;
  createdBy: string;
}

export interface ListDepotDraftsFilter {
  page: number;
  limit: number;
  status?: DepotDraftStatus;
}

export interface DepotDraftRepository {
  /** DRAFT first, then the rest, newest first within each. */
  list(filter: ListDepotDraftsFilter): Promise<{ items: DepotDraftRecord[]; total: number }>;
  findById(id: string): Promise<DepotDraftRecord | null>;
  /**
   * REJECTED + note + who/when, and the owner's name and phone cleared. Only while the row is
   * still DRAFT: null when it is not (or does not exist), so a double click cannot decide twice.
   */
  reject(id: string, note: string, decidedBy: string, at: Date): Promise<DepotDraftRecord | null>;
  /**
   * ONE database transaction: create the depot (already validated, `data` as it will be stored)
   * with crmProspectId and franchiseApplicationId, mark the draft ACTIVATED with depotId and
   * who/when, clear the owner's name and phone, and write the depot.onboarded outbox row. Nothing
   * is left behind when any step fails. Null when the draft is not DRAFT any more.
   * Throws DuplicateDepotCodeError when the code is taken.
   */
  activate(id: string, data: CreateDepotData, decidedBy: string, at: Date): Promise<{ draft: DepotDraftRecord; depotId: string; depotCode: string } | null>;
  findByProspectId(prospectId: string): Promise<DepotDraftRecord | null>;
  /** One row per prospect: a second insert for the same prospect throws Prisma's P2002. */
  create(data: NewDepotDraft): Promise<DepotDraftRecord>;
  /**
   * Reopen a REJECTED draft as DRAFT with new content, clearing the decision. Only lands while
   * the row is still REJECTED; returns null when it no longer is (somebody else got there first).
   */
  reopen(id: string, data: NewDepotDraft): Promise<DepotDraftRecord | null>;
}
