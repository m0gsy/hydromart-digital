import { Inject, Injectable, Logger } from '@nestjs/common';
import { dayStartUtc, localMonthKey } from '@hydromart/platform';

import {
  BankAccountMissingError,
  PartnerBillMonthInvalidError,
  PartnerBillMonthOpenError,
  PartnerBillNoRecipientsError,
  PartnerBillNotDraftError,
  PartnerBillNotFoundError,
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
    const result: GenerateResult = { month, made: 0, existing: 0, skippedZero: 0, unassigned: 0, commissionRows: 0 };

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

    const names = new Map<string, string>();
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
      // Only a franchisee pays royalty: the franchisor's and the operator's own depots are not billed.
      if (entities.get(s.legalEntityId)?.kind !== 'FRANCHISEE') continue;
      if (!names.has(s.depotId)) names.set(s.depotId, await this.sources.depotName(s.depotId));
      const adjustment =
        r.reversalRows > 0 ? `, termasuk koreksi pembatalan Rp${Math.round(r.reversalIdr).toLocaleString('id-ID')}` : '';
      const lines = perEntity.get(s.legalEntityId) ?? [];
      lines.push({
        depotId: s.depotId,
        label: `Royalti ${names.get(s.depotId)}${splitNote(s, firstDay, lastDay)}${adjustment}`,
        amountIdr: Math.round(r.commissionIdr),
        basis: {
          from: s.from,
          to: s.to,
          rows: r.rows,
          reversalRows: r.reversalRows,
          reversalIdr: Math.round(r.reversalIdr),
        },
      });
      perEntity.set(s.legalEntityId, lines);
    }
    result.unassigned = unassigned.size;

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

  /** The bills sent to this franchise owner, with their lines. */
  forOwner(ownerId: string): Promise<PartnerBillRecord[]> {
    return this.bills.listForOwner(ownerId, LIST_LIMIT);
  }

  /** Approve = send. Refused without the official account; the notice is filed before the bill is marked sent. */
  async approve(id: string, approverId: string): Promise<PartnerBillRecord> {
    const bill = await this.get(id);
    if (bill.status === 'VOID') throw new PartnerBillVoidedError();
    if (bill.status !== 'DRAFT') throw new PartnerBillNotDraftError();
    const bank = await this.sources.officialAccount();
    if (!bank) throw new BankAccountMissingError();

    // The accounts whose COMMISSION rows made each line: the owners of those depots then.
    const owners = new Set<string>();
    for (const line of bill.lines ?? []) {
      const rows = await this.ledger.commissionBasis(
        [line.depotId],
        dayStartUtc(line.basis.from),
        dayStartUtc(dayAfter(line.basis.to)),
      );
      for (const r of rows) r.ownerIds.forEach((o) => owners.add(o));
    }
    if (owners.size === 0) throw new PartnerBillNoRecipientsError();
    const recipientIds = [...owners].sort();

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

  /** A draft, or a sent bill with its reason. A voided month may be generated again. */
  async void(id: string, reason: string, actorId: string): Promise<PartnerBillRecord> {
    const bill = await this.get(id);
    if (bill.status === 'VOID') throw new PartnerBillVoidedError();
    const voided = await this.bills.markVoid(id, reason.trim());
    if (!voided) throw new PartnerBillVoidedError();
    this.logger.log(`partner.bill.void id=${id} by=${actorId} was=${bill.status}`);
    return voided;
  }
}
