export interface ProductRecord {
  id: string;
  categoryId: string | null;
  name: string;
  sku: string;
  description: string | null;
  unit: string;
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
