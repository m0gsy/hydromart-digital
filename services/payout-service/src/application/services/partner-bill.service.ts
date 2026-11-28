import { Inject, Injectable, Logger } from '@nestjs/common';
import { dayStartUtc, localDayKey, localMonthKey } from '@hydromart/platform';

import {
  BankAccountMissingError,
  PartnerBillMonthInvalidError,
  PartnerBillMonthOpenError,
  PartnerBillNoRecipientsError,
  PartnerBillNotDraftError,
  PartnerBillNotFoundError,
  PartnerBillNotSentError,
  PartnerBillPaidError,
  PartnerBillPaidOnFutureError,
  PartnerBillSendingError,
  PartnerBillVoidedError,
} from '../../domain/errors.partner-bill';
import {
  PartnerBillBasis,
  PartnerBillRecord,
  PartnerBillStatus,
  dayAfter,
  isMonthKey,
  monthLabel,
  monthWindow,
  splitNote,
  stretchesOf,
} from '../../domain/partner-bill';
import { LedgerRepository } from '../ports/ledger.repository';
import { PartnerBillRepository } from '../ports/partner-bill.repository';
import { PartnerBillNotifier, PartnerBillSources } from '../ports/partner-bill-sources.port';
import { PAYOUT_TOKENS } from '../tokens';

/** One open bill as the machine reads it: no owners, phones or account numbers. */
export interface OpenBill {
  id: string;
  month: string;
  monthLabel: string;
  legalEntityName: string;
  totalIdr: number;
  dueOn: string;
  depotCodes: string[];
}

/** What a generate run did. Counts only: this is also what the n8n machine route answers. */
export interface GenerateResult {
  month: string;
  /** Drafts made by this run. */
  made: number;
  /** Entities whose live bill for the month already existed (a rerun makes no second one). */
  existing: number;
  /** Entities with commission rows whose month nets to zero or less: no bill. */
  skippedZero: number;
  /** Depots with commission rows that belong to no legal entity yet: not billed to anyone. */
  unassigned: number;
  /** COMMISSION ledger rows the month holds in all. 0 = nothing was ever commissioned (no scheme set). */
  commissionRows: number;
  /** Legal entities named by a depot's history that depot-service could not describe: their depots are not billed. */
  unreadable: number;
  /** Billed depots no franchise owner is recorded for (ledger or ownership): a bill could not reach them. */
  noOwner: number;
  /** The codes of those depots. */
  noOwnerDepots: string[];
}

const LIST_LIMIT = 200;

/**
 * HD-23: the monthly royalty bill per FRANCHISEE legal entity.
 *
 * The amount is HQ's commission, the COMMISSION ledger rows (metric W-05), and nothing else: one
 * tariff source, never a second rate table. Customers pay the depot's own account and the ledger
 * balance is not paid out (PAYOUT_BY_PARTNER_BILL), so this bill is the only place that
 * commission is collected, and it is collected once.
 */
@Injectable()
export class PartnerBillService {
  private readonly logger = new Logger(PartnerBillService.name);

  constructor(
    @Inject(PAYOUT_TOKENS.LedgerRepository) private readonly ledger: LedgerRepository,
    @Inject(PAYOUT_TOKENS.PartnerBillRepository) private readonly bills: PartnerBillRepository,
    @Inject(PAYOUT_TOKENS.PartnerBillSources) private readonly sources: PartnerBillSources,
    @Inject(PAYOUT_TOKENS.PartnerBillNotifier) private readonly notifier: PartnerBillNotifier,
  ) {}

  /** Makes the drafts of a CLOSED month; safe to run twice (a live bill is never replaced or doubled). */
  async generate(month: string): Promise<GenerateResult> {
    if (!isMonthKey(month)) throw new PartnerBillMonthInvalidError(month);
    if (month >= localMonthKey(new Date())) throw new PartnerBillMonthOpenError(month);
    const { from, to, firstDay, lastDay } = monthWindow(month);
    const result: GenerateResult = {
      month,
      made: 0,
      existing: 0,
      skippedZero: 0,
      unassigned: 0,
      commissionRows: 0,
      unreadable: 0,
      noOwner: 0,
      noOwnerDepots: [],
    };

    const depotIds = await this.ledger.depotsWithCommission(from, to);
    if (depotIds.length === 0) return result;
    const stretches = stretchesOf(await this.sources.entityTimeline(depotIds, firstDay, lastDay), lastDay);

    const entityIds = [...new Set(stretches.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))];
    const entities = new Map((await this.sources.entities(entityIds)).map((e) => [e.id, e]));

    // One ledger read per distinct window (nearly always the whole month), not one per depot.
    const windows = new Map<string, { from: string; to: string; depotIds: Set<string> }>();
    for (const s of stretches) {
      const key = `${s.from}|${s.to}`;
      const w = windows.get(key) ?? { from: s.from, to: s.to, depotIds: new Set<string>() };
      w.depotIds.add(s.depotId);
      windows.set(key, w);
    }
    const basisOf = new Map<string, Awaited<ReturnType<LedgerRepository['commissionBasis']>>[number]>();
    for (const w of windows.values()) {
      const rows = await this.ledger.commissionBasis(
        [...w.depotIds],
        dayStartUtc(w.from),
        dayStartUtc(dayAfter(w.to)),
      );
      for (const r of rows) basisOf.set(`${r.depotId}|${w.from}|${w.to}`, r);
    }

    const depotInfo = new Map<string, { name: string; code: string }>();
    const unreadable = new Set<string>();
    const noOwner = new Set<string>();
    const perEntity = new Map<string, { depotId: string; label: string; amountIdr: number; basis: PartnerBillBasis }[]>();
    const unassigned = new Set<string>();
    for (const s of stretches) {
      const r = basisOf.get(`${s.depotId}|${s.from}|${s.to}`);
      if (!r) continue;
      result.commissionRows += r.rows;
      if (!s.legalEntityId) {
        unassigned.add(s.depotId);
        continue;
      }
      const entity = entities.get(s.legalEntityId);
      if (!entity) {
        // Never skipped silently: an entity depot-service cannot describe is counted and reported.
        unreadable.add(s.legalEntityId);
        continue;
      }
      // Only a franchisee pays royalty: the franchisor's and the operator's own depots are not billed.
      if (entity.kind !== 'FRANCHISEE') continue;
      let info = depotInfo.get(s.depotId);
      if (!info) {
        info = await this.sources.depot(s.depotId);
        depotInfo.set(s.depotId, info);
      }
      // The owners that held the depot at the end of these days, with the ones whose rows made the line.
      const endOfStretch = new Date(dayStartUtc(dayAfter(s.to)).getTime() - 1).toISOString();
      const ownerIds = [...new Set([...r.ownerIds, ...(await this.sources.ownersAsOf(s.depotId, endOfStretch))])].sort();
      if (ownerIds.length === 0) noOwner.add(info.code);
      const adjustment =
        r.reversalRows > 0 ? `, termasuk koreksi pembatalan Rp${Math.round(r.reversalIdr).toLocaleString('id-ID')}` : '';
      const lines = perEntity.get(s.legalEntityId) ?? [];
      lines.push({
        depotId: s.depotId,
        label: `Royalti ${info.name}${splitNote(s, firstDay, lastDay)}${adjustment}`,
        amountIdr: Math.round(r.commissionIdr),
        basis: {
          from: s.from,
          to: s.to,
          rows: r.rows,
          reversalRows: r.reversalRows,
          reversalIdr: Math.round(r.reversalIdr),
          ownerIds,
        },
      });
      perEntity.set(s.legalEntityId, lines);
    }
    result.unassigned = unassigned.size;
    result.unreadable = unreadable.size;
    result.noOwner = noOwner.size;
    result.noOwnerDepots = [...noOwner].sort();

    for (const [legalEntityId, lines] of perEntity) {
      const totalIdr = lines.reduce((n, l) => n + l.amountIdr, 0);
      if (totalIdr <= 0) {
        result.skippedZero += 1;
        continue;
      }
      if (await this.bills.findLive(legalEntityId, month)) {
        result.existing += 1;
        continue;
      }
      const created = await this.bills.create({
        legalEntityId,
        legalEntityName: entities.get(legalEntityId)!.name,
        month,
        totalIdr,
        lines,
      });
      if (created) {
        result.made += 1;
        this.logger.log(`partner.bill.drafted id=${created.id} entity=${legalEntityId} month=${month} total=${totalIdr}`);
      } else {
        result.existing += 1;
      }
    }
    return result;
  }

  list(filter: { month?: string; legalEntityId?: string; status?: PartnerBillStatus }): Promise<PartnerBillRecord[]> {
    return this.bills.list(filter, LIST_LIMIT);
  }

  async get(id: string): Promise<PartnerBillRecord> {
    const bill = await this.bills.findById(id);
    if (!bill) throw new PartnerBillNotFoundError();
    return bill;
  }

  /**
   * The bills sent to this franchise owner, with their lines. A withdrawn (VOID) bill keeps its reason
   * but never the account to pay into: nothing may be paid against it, so the answer itself drops it.
   */
  async forOwner(ownerId: string): Promise<PartnerBillRecord[]> {
    const bills = await this.bills.listForOwner(ownerId, LIST_LIMIT);
    return bills.map((b) => (b.status === 'VOID' ? { ...b, bank: null } : b));
  }

  /**
   * Approve = send. Refused without the official account. DRAFT -> SENDING first (a conditional
   * update, so a void cannot land between the notice and the mark), then the notice, then
   * SENDING -> SENT. A send that failed stays SENDING and approve finishes it: crm files one
   * notice per (bill, owner), so a retry tells nobody twice.
   */
  async approve(id: string, approverId: string): Promise<PartnerBillRecord> {
    const bill = await this.get(id);
    if (bill.status === 'VOID') throw new PartnerBillVoidedError();
    if (bill.status === 'SENT') throw new PartnerBillNotDraftError();
    const bank = await this.sources.officialAccount();
    if (!bank) throw new BankAccountMissingError();

    // The owners fixed when the draft was made: who held each depot then, and whose rows made the line.
    const recipientIds = [...new Set((bill.lines ?? []).flatMap((l) => l.basis.ownerIds ?? []))].sort();
    if (recipientIds.length === 0) throw new PartnerBillNoRecipientsError();

    if (!(await this.bills.beginSend(id))) throw new PartnerBillNotDraftError();
    await this.notifier.send({
      billId: bill.id,
      month: bill.month,
      monthLabel: monthLabel(bill.month),
      legalEntityName: bill.legalEntityName,
      totalIdr: bill.totalIdr,
      bank,
      recipientIds,
    });
    const sent = await this.bills.markSent(id, { approvedBy: approverId, recipientIds, bank });
    if (!sent) throw new PartnerBillNotDraftError();
    this.logger.log(`partner.bill.sent id=${id} by=${approverId} recipients=${recipientIds.length}`);
    return sent;
  }

  /**
   * HD-25: Finance marks a SENT bill paid. Idempotent: a bill already paid is returned as it is
   * (the first mark stands), so a second click or a retry changes nothing.
   */
  async markPaid(id: string, paidOn: string, ref: string | null, actorId: string): Promise<PartnerBillRecord> {
    const bill = await this.get(id);
    if (bill.status !== 'SENT') throw new PartnerBillNotSentError();
    if (paidOn > localDayKey(new Date())) throw new PartnerBillPaidOnFutureError();
    if (bill.paidAt) return bill;
    const paid = await this.bills.markPaid(id, { paidOn, ref, paidBy: actorId });
    if (!paid) return this.get(id); // somebody marked it between the read and the write
    this.logger.log(`partner.bill.paid id=${id} by=${actorId} on=${paidOn}`);
    return paid;
  }

  /**
   * HD-25: the sent, unpaid bills for the AI web's reminders, newest first. Depots are told by code
   * only (the AI side matches on it); nothing about owners or accounts leaves here.
   */
  async open(): Promise<OpenBill[]> {
    const codes = new Map<string, string>();
    const out: OpenBill[] = [];
    for (const b of await this.bills.listOpen(LIST_LIMIT)) {
      for (const l of b.lines ?? []) {
        if (!codes.has(l.depotId)) codes.set(l.depotId, (await this.sources.depot(l.depotId)).code);
      }
      out.push({
        id: b.id,
        month: b.month,
        monthLabel: monthLabel(b.month),
        legalEntityName: b.legalEntityName,
        totalIdr: b.totalIdr,
        dueOn: b.dueOn as string, // set when sent, and backfilled for the bills sent before HD-25
        depotCodes: [...new Set((b.lines ?? []).map((l) => codes.get(l.depotId) as string))].sort(),
      });
    }
    return out;
  }

  /**
   * A draft, or a sent bill with its reason (its owners are told, once each). Refused while it is
   * being sent. A voided month may be generated again.
   */
  async void(id: string, reason: string, actorId: string): Promise<PartnerBillRecord> {
    const bill = await this.get(id);
    if (bill.status === 'VOID') throw new PartnerBillVoidedError();
    if (bill.status === 'SENDING') throw new PartnerBillSendingError();
    if (bill.paidAt) throw new PartnerBillPaidError();
    const why = reason.trim();
    if (bill.status === 'SENT') {
      await this.notifier.sendVoid({
        billId: bill.id,
        monthLabel: monthLabel(bill.month),
        legalEntityName: bill.legalEntityName,
        reason: why,
        recipientIds: bill.recipientIds,
      });
    }
    const voided = await this.bills.markVoid(id, why);
    if (!voided) {
      // It moved between the read and the write: say which way.
      const now = await this.bills.findById(id);
      throw now?.status === 'SENDING' ? new PartnerBillSendingError() : new PartnerBillVoidedError();
    }
    this.logger.log(`partner.bill.void id=${id} by=${actorId} was=${bill.status}`);
    return voided;
  }
}
