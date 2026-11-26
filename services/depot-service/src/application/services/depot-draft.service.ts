import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { localDayKey } from '@hydromart/platform';

import {
  AlreadyOnboardedError,
  ChecklistIncompleteError,
  CoolingOffNotMetError,
  DepotDraftNotFoundError,
  DraftBusyError,
  DraftConflictError,
  InvalidDraftDatesError,
} from '../../domain/errors';
import { checkDraft, DepotDraftContent, DepotDraftRecord } from '../../domain/depot-draft';
import { DepotDraftRepository, NewDepotDraft } from '../ports/depot-draft.repository';
import { DepotRepository } from '../ports/depot.repository';
import { DEPOT_TOKENS } from '../tokens';

/** The replay key: the same content hashes the same whatever order a client wrote its keys in. */
export function requestHashOf(prospectId: string, c: DepotDraftContent): string {
  const canonical = JSON.stringify([
    prospectId,
    c.legacyApplicationId,
    c.proposedName,
    c.city,
    c.province,
    c.ownerFullName,
    c.ownerPhoneE164,
    c.prospectusHandedOn,
    c.agreementSignedOn,
    c.prospectusSha256,
    c.prospectusVersionLabel,
    c.prospectusReceipt,
    c.checklist.ktpNpwp,
    c.checklist.locationProof,
    c.checklist.capitalDeposit,
    c.checklist.fieldSurvey,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export interface DepotDraftStatusView {
  draftId: string;
  status: DepotDraftRecord['status'];
  decisionNote: string | null;
  depotId: string | null;
  depotCode: string | null;
  updatedAt: Date;
}

/**
 * HD-21a: a depot draft from the AI web's CRM. Never a depot (HQ activates it later) and nothing
 * is sent to the owner here (D4). One row per prospect; see `draftFromCrm` for the replay rules.
 */
@Injectable()
export class DepotDraftService {
  constructor(
    @Inject(DEPOT_TOKENS.DepotDraftRepository) private readonly drafts: DepotDraftRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  async draftFromCrm(
    prospectId: string,
    content: DepotDraftContent,
    ai: { suggestionId: string; createdBy: string },
  ): Promise<{ draft: DepotDraftRecord; replayed: boolean }> {
    const verdict = checkDraft(content, localDayKey(new Date()));
    if (!verdict.ok) {
      if (verdict.reason === 'CHECKLIST_INCOMPLETE') throw new ChecklistIncompleteError(verdict.items);
      if (verdict.reason === 'COOLING_OFF_NOT_MET') throw new CoolingOffNotMetError(verdict.earliestOn);
      throw new InvalidDraftDatesError(verdict.message);
    }
    const data: NewDepotDraft = {
      ...content,
      prospectId,
      requestHash: requestHashOf(prospectId, content),
      suggestionId: ai.suggestionId,
      createdBy: ai.createdBy,
    };
    const existing = await this.drafts.findByProspectId(prospectId);
    if (existing) return this.settle(existing, data);
    try {
      return { draft: await this.drafts.create(data), replayed: false };
    } catch (e) {
      // Two calls for one prospect at once: the unique index let one in; the other answers it.
      if ((e as { code?: string })?.code !== 'P2002') throw e;
      const raced = await this.drafts.findByProspectId(prospectId);
      if (!raced) throw e;
      return this.settle(raced, data);
    }
  }

  async statusOf(prospectId: string): Promise<DepotDraftStatusView> {
    const row = await this.drafts.findByProspectId(prospectId);
    if (!row) throw new DepotDraftNotFoundError();
    return {
      draftId: row.id,
      status: row.status,
      decisionNote: row.decisionNote,
      depotId: row.depotId,
      depotCode: await this.codeOf(row.depotId),
      updatedAt: row.updatedAt,
    };
  }

  /** What an existing row means for this call: replay, conflict, onboarded, or reopen. */
  private async settle(
    row: DepotDraftRecord,
    data: NewDepotDraft,
  ): Promise<{ draft: DepotDraftRecord; replayed: boolean }> {
    if (row.status === 'ACTIVATED') {
      throw new AlreadyOnboardedError(row.depotId, await this.codeOf(row.depotId));
    }
    if (row.status === 'REJECTED') {
      // Lost the race to another reopen (or an activation) is answered by what is there now. A row
      // that is still (or again) REJECTED after one retry is not the caller's conflict: busy, retry.
      for (let attempt = 0; attempt < 2; attempt++) {
        const reopened = await this.drafts.reopen(row.id, data);
        if (reopened) return { draft: reopened, replayed: false };
        const now = await this.drafts.findByProspectId(data.prospectId);
        if (now && now.status !== 'REJECTED') return this.settle(now, data);
      }
      throw new DraftBusyError();
    }
    if (row.requestHash !== data.requestHash) throw new DraftConflictError();
    return { draft: row, replayed: true };
  }

  private async codeOf(depotId: string | null): Promise<string | null> {
    if (!depotId) return null;
    return (await this.depots.findById(depotId, false))?.code ?? null;
  }
}
