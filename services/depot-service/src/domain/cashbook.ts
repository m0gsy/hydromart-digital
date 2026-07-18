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
