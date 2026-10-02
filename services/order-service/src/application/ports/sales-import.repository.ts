export interface ImportedSalesTransactionRecord {
  id: string;
  depotId: string;
  externalRef: string;
  occurredAt: Date;
  customerLabel: string | null;
  productLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  paymentMethod: string | null;
  batchId: string;
  importedBy: string | null;
  importedAt: Date;
}

export interface NewImportedSalesTransaction {
  depotId: string;
  externalRef: string;
  occurredAt: Date;
  customerLabel: string | null;
  productLabel: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  paymentMethod: string | null;
  batchId: string;
  importedBy: string | null;
}

export interface HistoricalDepotSum {
  depotId: string;
  orders: number;
  revenue: number;
}

export interface HistoricalProductSum {
  productLabel: string;
  orders: number;
  revenue: number;
}

export interface HistoricalMethodSum {
  /** Free text normalised to CASH/TRANSFER/QRIS/EWALLET/VA/OTHER — see normalizeMethod(). */
  method: string;
  orders: number;
  revenue: number;
}

export interface SalesImportRepository {
  /** Throws on a (depotId, externalRef) collision — the caller classifies that as a duplicate. */
  create(row: NewImportedSalesTransaction): Promise<ImportedSalesTransactionRecord>;
  listByDepot(
    depotId: string,
    range: { from: Date; to: Date },
  ): Promise<ImportedSalesTransactionRecord[]>;
  /**
   * Revenue/order-count summed per depot within the window — for the revenue-by-depot
   * report. Either bound omitted means unbounded on that side, same as `ReportRange`.
   */
  sumByDepot(range: { from?: Date; to?: Date }): Promise<HistoricalDepotSum[]>;
  /** Revenue/order-count summed per product label within the window. */
  sumByProduct(range: { from?: Date; to?: Date }): Promise<HistoricalProductSum[]>;
  /** Revenue/order-count summed per normalised payment method within the window. */
  sumByMethod(range: { from?: Date; to?: Date }): Promise<HistoricalMethodSum[]>;
}

/**
 * Free text from an old system, folded onto the five real payment methods or 'OTHER'.
 * Exported so the controller and the repository agree on exactly one mapping.
 */
export function normalizeMethod(raw: string | null): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return 'OTHER';
  if (/tunai|cash|kontan/.test(s)) return 'CASH';
  if (/transfer|rekening|bank/.test(s)) return 'TRANSFER';
  if (/qris/.test(s)) return 'QRIS';
  if (/e-?wallet|ovo|gopay|dana|shopeepay/.test(s)) return 'EWALLET';
  if (/virtual account|^va$/.test(s)) return 'VA';
  return 'OTHER';
}
