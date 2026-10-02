import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, ImportSummary, runImport } from '@hydromart/platform';

import {
  HistoricalDepotSum,
  HistoricalMethodSum,
  HistoricalProductSum,
  SalesImportRepository,
} from '../ports/sales-import.repository';
import { isDuplicateExternalRef } from '../../infrastructure/prisma/sales-import.prisma.repository';
import { ORDER_TOKENS } from '../tokens';

export interface ImportSalesTransactionRow {
  externalRef: string;
  occurredAt: string;
  customerLabel?: string;
  productLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  paymentMethod?: string;
}

/**
 * Bulk import for historical sales transactions (items 3/11 of the 2026 evaluation list) —
 * see the ImportedSalesTransaction model comment for why this never touches `Order`.
 */
@Injectable()
export class SalesImportService {
  constructor(
    @Inject(ORDER_TOKENS.SalesImportRepository) private readonly repo: SalesImportRepository,
  ) {}

  async importTransactions(
    user: AuthenticatedUser,
    depotId: string,
    rows: readonly ImportSalesTransactionRow[],
  ): Promise<ImportSummary> {
    const batchId = randomUUID();
    return runImport(
      rows,
      async (row) => {
        await this.repo.create({
          depotId,
          externalRef: row.externalRef,
          occurredAt: new Date(row.occurredAt),
          customerLabel: row.customerLabel ?? null,
          productLabel: row.productLabel,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          lineTotal: row.lineTotal,
          paymentMethod: row.paymentMethod ?? null,
          batchId,
          importedBy: user.sub,
        });
        return { status: 'created' };
      },
      isDuplicateExternalRef,
    );
  }

  listByDepot(depotId: string, from: Date, to: Date) {
    return this.repo.listByDepot(depotId, { from, to });
  }

  sumByDepot(from?: Date, to?: Date): Promise<HistoricalDepotSum[]> {
    return this.repo.sumByDepot({ from, to });
  }

  sumByProduct(from?: Date, to?: Date): Promise<HistoricalProductSum[]> {
    return this.repo.sumByProduct({ from, to });
  }

  sumByMethod(from?: Date, to?: Date): Promise<HistoricalMethodSum[]> {
    return this.repo.sumByMethod({ from, to });
  }
}
