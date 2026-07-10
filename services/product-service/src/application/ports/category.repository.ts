export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCategoryData {
  name: string;
  slug: string;
  sortOrder: number;
}

export type UpdateCategoryData = Partial<CreateCategoryData & { active: boolean }>;

export interface CategoryRepository {
  list(activeOnly: boolean): Promise<CategoryRecord[]>;
  findById(id: string): Promise<CategoryRecord | null>;
  findBySlug(slug: string): Promise<CategoryRecord | null>;
  create(data: CreateCategoryData): Promise<CategoryRecord>;
  update(id: string, patch: UpdateCategoryData): Promise<CategoryRecord>;
}
