import { PurchaseRow } from '../../domain/reorder';
import { CoBuyRow } from '../../domain/co-buy';

export interface IngestItem {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
}

export interface IngestCommand {
  orderId: string;
  customerId: string;
  depotId: string | null;
  items: IngestItem[];
  at: Date;
}

export interface RecommendationRepository {
  hasIngested(orderId: string): Promise<boolean>;

  /**
   * Applies one order's worth of read-model writes (purchase counts, product refs,
   * daily sales, co-buy pairs, ingested-order marker) atomically. Caller (the ingest
   * service) is responsible for the hasIngested idempotency guard before calling this.
   */
  applyIngest(cmd: IngestCommand): Promise<void>;

  reorderRows(customerId: string): Promise<PurchaseRow[]>;

  /** baseCount = ProductRef.buyCount for productId (times productId itself was bought), 0 if unknown. */
  relatedRows(productId: string): Promise<{ rows: CoBuyRow[]; baseCount: number }>;

  /**
   * Trending products, already summed, ordered and limited by the database (audit S-18).
   * This used to return every daily row since `fromDay` — a year's worth for a network-wide
   * window — so the service could add them up and keep ten.
   */
  trendingTotals(
    depotId: string | null,
    fromDay: Date,
    limit: number,
  ): Promise<{ productId: string; score: number }[]>;

  productRefs(ids: string[]): Promise<Map<string, { name: string; sku: string; unit: string }>>;
}
