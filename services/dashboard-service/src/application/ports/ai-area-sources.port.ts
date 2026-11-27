import { SourceSpan } from './ai-customer-sources.port';

/**
 * HD-20c: the facts behind the areas read. `deadline` is the epoch ms by which the WHOLE read must be over
 * (one budget across all calls). Every method answers null when its source cannot answer
 * (down, non-2xx, a shape it does not recognise): the metric then says belum_ada, never a partial sum.
 */
export interface AreaPin {
  /** A small number per distinct customer WITHIN one answer, never an id. */
  k: number;
  /** null = the order has no pin. */
  lat: number | null;
  lng: number | null;
  orders: number;
  galon: number;
}

export interface RegionRef {
  code: string;
  name: string;
}

export interface RegionHit {
  kecamatan: RegionRef | null;
  kelurahan: RegionRef | null;
  gridCell: string;
}

export interface UnservedCell {
  /** null = no kelurahan recorded. */
  code: string | null;
  name: string | null;
  count: number;
}

export interface UnservedSummary {
  kecamatan: UnservedCell[];
  kelurahan: UnservedCell[];
  grid: { cell: string; count: number }[];
  bands: { band: string; count: number }[];
}

export interface AiAreaSourcesPort {
  /** Pins of the counted orders in the spans (order-service). */
  areaPins(spans: readonly SourceSpan[], deadline: number): Promise<AreaPin[] | null>;
  /** The region of each pin, in order (customer-service); the caller sends no customer or address. */
  lookupRegions(points: readonly { lat: number; lng: number }[], deadline: number): Promise<RegionHit[] | null>;
  /** Anonymous out-of-area pins of one WIB month, counted per cell and per distance band (customer-service). */
  unservedDemand(month: string, deadline: number): Promise<UnservedSummary | null>;
}
