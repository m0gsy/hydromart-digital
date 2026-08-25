export interface Reseller {
  customerId: string;
  homeDepotId: string;
  monthlyTargetQty: number;
  discountPct: number;
  /** Depot SOP: flat rupiah per gallon; > 0 overrides `discountPct` at checkout. */
  flatGallonPriceIdr: number;
  photoUrl: string | null;
  active: boolean;
  joinDate: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateResellerData {
  customerId: string;
  homeDepotId: string;
  monthlyTargetQty: number;
  discountPct?: number;
  flatGallonPriceIdr?: number;
  photoUrl?: string | null;
  joinDate: Date;
  note?: string | null;
}

export interface UpdateResellerData {
  homeDepotId?: string;
  monthlyTargetQty?: number;
  discountPct?: number;
  flatGallonPriceIdr?: number;
  photoUrl?: string | null;
  active?: boolean;
  note?: string | null;
}

/**
 * K4.2. One recorded change to what an agen pays. A row with `appliedAt === null` is a
 * change that has not happened yet — the schedule and the audit trail are the same list,
 * read from two ends.
 */
export interface ResellerPriceChange {
  id: string;
  customerId: string;
  changedBy: string;
  /** discountPct | flatGallonPriceIdr | active */
  field: PricedField;
  oldValue: string;
  newValue: string;
  effectiveAt: Date;
  appliedAt: Date | null;
  createdAt: Date;
}

/**
 * The fields a change is recorded for. Deliberately not every column: moving a note or a
 * photo is housekeeping, and burying the money in a list of it is how an audit trail
 * stops being read. `active` is here because a deactivated agen pays retail — that is a
 * price change wearing a different name.
 */
export const PRICED_FIELDS = ['discountPct', 'flatGallonPriceIdr', 'active'] as const;
export type PricedField = (typeof PRICED_FIELDS)[number];

export interface RecordPriceChangeData {
  customerId: string;
  changedBy: string;
  field: PricedField;
  oldValue: string;
  newValue: string;
  effectiveAt: Date;
  appliedAt: Date | null;
}

export interface ResellerRepository {
  /** Registry rows, newest first. Filter by home depot and/or active flag. */
  list(filter: { homeDepotIds?: readonly string[]; active?: boolean }): Promise<Reseller[]>;
  findById(customerId: string): Promise<Reseller | null>;
  create(data: CreateResellerData): Promise<Reseller>;
  update(customerId: string, patch: UpdateResellerData): Promise<Reseller>;
  /** K4.2: append one recorded change. Never updates in place — history is append-only. */
  recordPriceChange(data: RecordPriceChangeData): Promise<ResellerPriceChange>;
  /** K4.2: this agen's changes, newest first, applied and scheduled alike. */
  listPriceChanges(customerId: string, limit: number): Promise<ResellerPriceChange[]>;
  /**
   * K4.2: scheduled changes whose moment has come and that nothing has applied yet.
   * Bounded — a sweep must not be able to load an unbounded backlog into memory.
   */
  findDuePriceChanges(now: Date, limit: number): Promise<ResellerPriceChange[]>;
  /** K4.2: stamp one scheduled change as applied. Only ever after the profile moved. */
  markPriceChangeApplied(id: string, at: Date): Promise<void>;
}
