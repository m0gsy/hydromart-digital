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

export interface UnservedDemandRepository {
  /**
   * The row and the address's `unservedMonth` marker in ONE transaction. The marker only lands
   * if the address still has the same pin, still has a kecamatan code and is not already marked
   * this month; otherwise (pin moved or removed, anonymised, already marked) nothing is written
   * and this returns false.
   */
  record(row: UnservedDemandRow, marker: UnservedMarker): Promise<boolean>;
}
