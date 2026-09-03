import { Inject, Injectable } from '@nestjs/common';

import { CashbookEntry, CashbookSummary, CashDirection, summarize } from '../../domain/cashbook';
import {
  CashbookAlreadyReversedError,
  CashbookCannotReverseReversalError,
  CashbookEntryNotFoundError,
  DepotNotFoundError,
} from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { CashbookDateRange, CashbookRepository } from '../ports/cashbook.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface RecordCashInput {
  depotId: string;
  direction: CashDirection;
  category: string;
  label: string;
  amountIdr: number;
  occurredAt?: Date | null;
}

export interface CashbookView {
  entries: CashbookEntry[];
  summary: CashbookSummary;
}

/**
 * Depot cashbook (design 14c): append-only cash in/out entries with a per-view
 * in/out/net summary over the (optionally date-filtered) rows.
 */
@Injectable()
export class CashbookService {
  constructor(
    @Inject(DEPOT_TOKENS.CashbookRepository) private readonly cashbook: CashbookRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  async list(depotId: string, range: CashbookDateRange = {}): Promise<CashbookView> {
    await this.requireDepot(depotId);
    const entries = await this.cashbook.listForDepot(depotId, range);
    return { entries, summary: summarize(entries) };
  }

  async record(input: RecordCashInput, actorId: string): Promise<CashbookEntry> {
    await this.requireDepot(input.depotId);
    return this.cashbook.create({
      depotId: input.depotId,
      direction: input.direction,
      category: input.category,
      label: input.label,
      amountIdr: input.amountIdr,
      occurredAt: input.occurredAt ?? new Date(),
      sourceRef: null,
      reversesId: null,
      reversalReason: null,
      actorId,
    });
  }

  /**
   * CA-2-22: correct a mistake by posting its opposite.
   *
   * The cashbook had no correction path of any kind — POST to record, GET to list, and
   * nothing else. A depot that typed Rp 5.000.000 where it meant Rp 500.000 had no way to
   * put it right, and the book stayed wrong for as long as it existed, while the daily
   * close and every report above it read from that same book.
   *
   * Deliberately NOT an edit. A ledger you can edit is a ledger nobody can audit: the
   * number changes and the fact that it changed does not survive. The original stays
   * exactly as posted, a second entry cancels it, and the pair explains itself to whoever
   * reads the book next — which is what the reason is for.
   */
  async reverse(entryId: string, reason: string, actorId: string): Promise<CashbookEntry> {
    const original = await this.cashbook.findById(entryId);
    if (!original) throw new CashbookEntryNotFoundError();
    // A correction of a correction would be three entries where two would do, and no
    // reader able to say which one is live. Posting the original again is the way back.
    if (original.reversesId) throw new CashbookCannotReverseReversalError();
    // Checked here AND enforced by a partial unique index: two operators pressing the
    // button together would otherwise leave the book wrong in the other direction.
    if (await this.cashbook.findReversalOf(entryId)) throw new CashbookAlreadyReversedError();

    return this.cashbook.create({
      depotId: original.depotId,
      // The opposite leg: an IN is cancelled by an OUT of the same size.
      direction: original.direction === CashDirection.IN ? CashDirection.OUT : CashDirection.IN,
      category: original.category,
      label: `Koreksi: ${original.label}`,
      amountIdr: original.amountIdr,
      // Posted when the correction was made, not backdated to the mistake: the book has to
      // show that today's balance moved, or the daily close disagrees with the drawer.
      occurredAt: new Date(),
      sourceRef: original.sourceRef,
      reversesId: original.id,
      reversalReason: reason,
      actorId,
    });
  }
}
