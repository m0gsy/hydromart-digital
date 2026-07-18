import { Inject, Injectable } from '@nestjs/common';

import { CashbookEntry, CashbookSummary, CashDirection, summarize } from '../../domain/cashbook';
import { DepotNotFoundError } from '../../domain/errors';
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
    if (!(await this.depots.findById(depotId, false))) {
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
      actorId,
    });
  }
}
