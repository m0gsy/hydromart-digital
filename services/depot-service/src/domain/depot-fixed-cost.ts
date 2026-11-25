// HD-16 (D22): one fixed cost of a depot for a month, e.g. rent or employer BPJS. Whole rupiah.
export interface DepotFixedCost {
  id: string;
  depotId: string;
  depotCode: string;
  depotName: string;
  /** WIB month key, e.g. "2026-11". */
  month: string;
  /** Lower-cased and trimmed, 1-40 characters. */
  category: string;
  amountIdr: number;
  note: string | null;
  updatedAt: Date;
}
