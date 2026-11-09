import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, ImportSummary, localDayKey, runImport } from '@hydromart/platform';

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
    // ORD-14: owner decision is a warning, not a refusal, for a receipt dated after go-live.
    const goLive = await this.repo.firstOrderAt(depotId);
    // ORD-14: rows of one receipt take line numbers in file order, so a multi-product receipt is
    // not skipped as a duplicate of its own first line, and the same file again gives the same
    // numbers (a re-upload stays a no-op).
    const seen = new Map<string, number>();
    return runImport(
      rows,
      async (row) => {
        // ORD-14: the total is derivable, so a row that disagrees with itself is refused by
        // name rather than merged into a depot's revenue. Half a rupiah of slack either way
        // covers a unit price typed to two decimals.
        const expected = row.unitPrice * row.quantity;
        if (Math.abs(row.lineTotal - expected) > 0.5) {
          throw new Error(
            `lineTotal ${row.lineTotal.toLocaleString('id-ID')} tidak sama dengan harga satuan x jumlah ` +
              `(${row.unitPrice.toLocaleString('id-ID')} x ${row.quantity} = ${expected.toLocaleString('id-ID')})`,
          );
        }
        const lineNo = seen.get(row.externalRef) ?? 0;
        seen.set(row.externalRef, lineNo + 1);
        await this.repo.create({
          depotId,
          externalRef: row.externalRef,
          lineNo,
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
        const afterGoLive = goLive !== null && new Date(row.occurredAt) >= goLive;
        return afterGoLive
          ? {
              status: 'created',
              message: `Tanggal nota sama dengan atau setelah pesanan pertama depot ini di Hydromart (${localDayKey(goLive)}); periksa agar tidak dobel dengan pesanan hidup`,
            }
          : { status: 'created' };
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
