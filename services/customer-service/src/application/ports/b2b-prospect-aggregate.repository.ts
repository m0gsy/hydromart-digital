/**
 * AREA-3: prospects counted per cell for the AI read API. Only grouped numbers leave the database:
 * no name, phone, address, coordinate or id of a prospect, customer, assignee or visitor is ever selected.
 */
export type ProspectAggKind = 'stock' | 'conversions' | 'visits';
export type ProspectAggLevel = 'depot' | 'kecamatan' | 'kelurahan' | 'grid';

export interface ProspectAggQuery {
  kind: ProspectAggKind;
  level: ProspectAggLevel;
  /** `[from, to)` of the month asked (WIB month as UTC instants); unused by `stock`. */
  from: Date;
  to: Date;
  /** Today in WIB, `YYYY-MM-DD`: the day a data age is counted to. */
  today: string;
  /** null = every depot. */
  depotIds: readonly string[] | null;
  /** Adds the prospects no depot serves (`ownerDepotId` null). */
  opportunity: boolean;
}

export interface ProspectAggCell {
  /** Depot id, BPS code or grid cell; null = unknown (or, at depot level, the opportunity bucket). */
  key: string | null;
  /** Kelurahan level: the kecamatan code of the row (also set when the kelurahan is unknown). */
  parent: string | null;
  /** Prospects (stock, conversions) or accepted visits (visits). */
  total: number;
  byCategory?: Record<string, number>;
  byStatus?: Record<string, number>;
  byOutcome?: Record<string, number>;
  withPhone?: number;
  dataAgeDaysMedian?: number;
  prospectsVisited?: number;
}

export interface B2bProspectAggregateRepository {
  aggregate(q: ProspectAggQuery): Promise<ProspectAggCell[]>;
}
