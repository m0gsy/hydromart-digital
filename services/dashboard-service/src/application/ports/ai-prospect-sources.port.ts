/**
 * AREA-3: the facts behind the prospects read. `deadline` is the epoch ms by which the WHOLE read must be
 * over. The answer is null when customer-service cannot give it (down, non-2xx, a shape it does not
 * recognise): the metric then says belum_ada, never a partial sum.
 */
export type ProspectKind = 'stock' | 'conversions' | 'visits';
export type ProspectLevel = 'depot' | 'kecamatan' | 'kelurahan' | 'grid';

export interface ProspectQuery {
  kind: ProspectKind;
  level: ProspectLevel;
  /** `YYYY-MM`, WIB. */
  month: string;
  /** null = every depot. */
  depotIds: readonly string[] | null;
  /** Adds the prospects no depot serves. */
  opportunity: boolean;
}

/** One cell as customer-service counts it: a code or an id, the name of a region, and numbers. Nothing else. */
export interface ProspectAggregate {
  /** Depot id, BPS code or grid cell; null = unknown (at depot level: the opportunity bucket). */
  key: string | null;
  /** Kelurahan level: the kecamatan code. */
  parent: string | null;
  name: string | null;
  /** Prospects or, for `visits`, accepted visits. */
  total: number;
  byCategory?: Record<string, number>;
  byStatus?: Record<string, number>;
  byOutcome?: Record<string, number>;
  withPhone?: number;
  dataAgeDaysMedian?: number;
  prospectsVisited?: number;
}

export interface AiProspectSourcesPort {
  prospectAggregates(query: ProspectQuery, deadline: number): Promise<ProspectAggregate[] | null>;
}
