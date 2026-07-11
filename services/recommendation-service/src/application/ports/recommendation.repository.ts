import { PurchaseRow } from '../../domain/reorder';
import { CoBuyRow } from '../../domain/co-buy';
import { DailyRow } from '../../domain/trending';

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

  trendingRows(depotId: string | null, fromDay: Date): Promise<DailyRow[]>;

  productRefs(ids: string[]): Promise<Map<string, { name: string; sku: string; unit: string }>>;
}
