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
  findBySku(sku: string): Promise<ProductRecord | null>;
  create(data: CreateProductData): Promise<ProductRecord>;
  update(id: string, patch: UpdateProductData): Promise<ProductRecord>;
}
