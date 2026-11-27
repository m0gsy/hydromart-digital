/** HD-20b: one anonymous "a pin outside every depot's area" row. See the UnservedDemand model. */
export interface UnservedDemandRow {
  monthKey: string;
  kecamatanCode: string;
  kelurahanCode: string | null;
  gridCell: string;
  distanceBand: string;
}

/** The address the row was derived from, as it was when the pin was judged. */
export interface UnservedMarker {
  customerId: string;
  addressId: string;
  latitude: number;
  longitude: number;
}

/** HD-20c: the rows of one month counted per cell and per band, aggregated in SQL (a null code = no kelurahan). */
export interface UnservedSummary {
  kecamatan: { code: string | null; count: number }[];
  kelurahan: { code: string | null; count: number }[];
  grid: { cell: string; count: number }[];
  bands: { band: string; count: number }[];
}

export interface UnservedDemandRepository {
  summarize(monthKey: string): Promise<UnservedSummary>;
  /**
   * The row and the address's `unservedMonth` marker in ONE transaction. The marker only lands
   * if the address still has the same pin, still has a kecamatan code and is not already marked
   * this month, and the customer has no OTHER address already counted this month in the same
   * kecamatan (so a row is one person per kecamatan per month); otherwise nothing is written
   * and this returns false.
   */
  record(row: UnservedDemandRow, marker: UnservedMarker): Promise<boolean>;
}
