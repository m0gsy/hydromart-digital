/** HD-20b: one anonymous "a pin outside every depot's area" row. See the UnservedDemand model. */
export interface UnservedDemandRow {
  monthKey: string;
  kecamatanCode: string;
  kelurahanCode: string | null;
  gridCell: string;
  distanceBand: string;
}

export interface UnservedDemandRepository {
  record(row: UnservedDemandRow): Promise<void>;
}
