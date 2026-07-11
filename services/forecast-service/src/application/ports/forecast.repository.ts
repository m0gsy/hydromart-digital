export interface IngestItem {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
}

export interface IngestCommand {
  orderId: string;
  depotId: string | null;
  items: IngestItem[];
  at: Date;
}

/** One daily-demand cell. `day` = epoch day number (see domain series.ts `toUtcDay`). */
export interface DemandRow {
  productId: string;
  depotId: string | null;
  day: number;
  quantity: number;
}

export interface ProductRefRecord {
  productId: string;
  name: string;
  sku: string;
  unit: string;
}

export interface ForecastRepository {
  hasIngested(orderId: string): Promise<boolean>;

  /**
   * Applies one order's demand into the read model atomically: upserts each ProductRef,
   * increments ProductDailyDemand (quantity += item.quantity, orderCount += 1) at
   * (productId, depotId, toUtcDay(at)), and inserts the IngestedOrder marker. Idempotent:
   * if orderId is already ingested it is a no-op (the PK insert is the concurrency backstop).
   */
  applyIngest(cmd: IngestCommand): Promise<void>;

  /**
   * Daily-demand rows for one product within [fromDay, toDay] inclusive.
   *
   * depotId distinguishes three cases:
   *   - undefined -> ALL depots (rows from every depot incl. the null-depot; caller sums into a global series).
   *   - null      -> ONLY the null-depot rows.
   *   - "<id>"    -> only that specific depot.
   */
  findDemandRows(query: {
    productId: string;
    depotId?: string | null;
    fromDay: number;
    toDay: number;
  }): Promise<DemandRow[]>;

  /**
   * Every product with demand at `depotId` within [fromDay, toDay], grouped by product,
   * each with its own DemandRow[] (drives the depot rollup query).
   */
  listDepotProducts(query: {
    depotId: string;
    fromDay: number;
    toDay: number;
  }): Promise<{ productId: string; rows: DemandRow[] }[]>;

  /** ProductRef snapshots for the given ids (missing ids omitted); enriches responses. */
  findRefs(productIds: string[]): Promise<ProductRefRecord[]>;
}
