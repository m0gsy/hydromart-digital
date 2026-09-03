// Depot cashbook / daily cash-flow ledger (design 14c). Append-only rows of cash in
// (COD settlement, walk-in sale) and out (PO payment, commission, expenses).
// Mirrors the Prisma CashDirection enum; the domain never imports the generated client.

export enum CashDirection {
  IN = 'IN',
  OUT = 'OUT',
}

export interface CashbookEntry {
  id: string;
  depotId: string;
  direction: CashDirection;
  category: string;
  label: string;
  amountIdr: number;
  occurredAt: Date;
  sourceRef: string | null;
  /**
   * CA-2-22: the entry this one cancels.
   *
   * The book is append-only on purpose — a ledger you can edit is a ledger nobody can
   * audit — so a mistake is put right by posting the opposite, not by rewriting history.
   * Null on every ordinary entry.
   */
  reversesId: string | null;
  /** Why it was reversed. Always set when `reversesId` is. */
  reversalReason: string | null;
  actorId: string;
  createdAt: Date;
}

export interface CashbookSummary {
  inIdr: number;
  outIdr: number;
  netIdr: number;
}

/** Sum cash in (IN) and out (OUT) over a set of entries; net = in − out. */
export function summarize(
  entries: Pick<CashbookEntry, 'direction' | 'amountIdr'>[],
): CashbookSummary {
  let inIdr = 0;
  let outIdr = 0;
  for (const e of entries) {
    if (e.direction === CashDirection.IN) inIdr += e.amountIdr;
    else outIdr += e.amountIdr;
  }
  return { inIdr, outIdr, netIdr: inIdr - outIdr };
}
