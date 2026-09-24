export interface ProductRecord {
  id: string;
  categoryId: string | null;
  name: string;
  sku: string;
  description: string | null;
  unit: string;
  /** Fill volume in millilitres (19000 = 19L galon). Null for non-liquid lines. */
  volumeMl: number | null;
  /** Refillable galon line. Separate from volumeMl — a 600ml bottle has volume too. */
  isGallon: boolean;
  basePrice: number;
  imageUrl: string | null;
  /** Additional gallery images beyond the primary imageUrl. */
  images: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductQuery {
  page: number;
  limit: number;
  categoryId?: string;
  search?: string;
  /** When true, only active products are returned (public browse). */
  activeOnly: boolean;
}

export interface CreateProductData {
  categoryId: string | null;
  name: string;
  sku: string;
  description: string | null;
  unit: string;
  volumeMl: number | null;
  isGallon: boolean;
  basePrice: number;
  imageUrl: string | null;
  images: string[];
}

export type UpdateProductData = Partial<CreateProductData & { active: boolean }>;

export interface ProductRepository {
  search(query: ProductQuery): Promise<{ items: ProductRecord[]; total: number }>;
  findById(id: string, activeOnly: boolean): Promise<ProductRecord | null>;
  /** Many active products in one read — the batch behind checkout's line resolution (S-7). */
  findActiveByIds(ids: string[]): Promise<ProductRecord[]>;
  findBySku(sku: string): Promise<ProductRecord | null>;
  create(data: CreateProductData): Promise<ProductRecord>;
  update(id: string, patch: UpdateProductData): Promise<ProductRecord>;
  /**
   * PRD-1: record that the base price moved, and who moved it. Append-only.
   *
   * Written in the SAME transaction as the update, so a trail can never disagree with the
   * price it is supposed to explain — a best-effort write would leave exactly the gap the
   * finding is about, just less often.
   */
  updateWithPriceAudit(
    id: string,
    patch: UpdateProductData,
    audit: { changedBy: string; fromPrice: number; toPrice: number },
  ): Promise<ProductRecord>;
  /** PRD-1: the recorded changes for one product, newest first. */
  listPriceChanges(productId: string, limit: number): Promise<PriceChangeRecord[]>;
}

/** PRD-1: one recorded move of a product's base price. */
export interface PriceChangeRecord {
  id: string;
  productId: string;
  changedBy: string;
  fromPrice: number;
  toPrice: number;
  changedAt: Date;
}
