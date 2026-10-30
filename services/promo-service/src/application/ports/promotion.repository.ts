export interface PromotionRecord {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  voucherCode: string | null;
  sortOrder: number;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields for creating a promotion. */
export interface CreatePromotionData {
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  voucherCode: string | null;
  sortOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Partial patch for an existing promotion; omitted keys are left unchanged. */
export interface UpdatePromotionData {
  title?: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  voucherCode?: string | null;
  sortOrder?: number;
  active?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface PromotionRepository {
  findById(id: string): Promise<PromotionRecord | null>;
  create(data: CreatePromotionData): Promise<PromotionRecord>;
  /**
   * `expectedUpdatedAt`: write only if the row still carries the stamp the editor read (a
   * compare-and-set). A mismatch throws StaleWriteError, so two editors holding the same
   * stamp cannot both get past the freshness check and overwrite each other.
   */
  update(
    id: string,
    data: UpdatePromotionData,
    expectedUpdatedAt?: Date,
  ): Promise<PromotionRecord>;
  delete(id: string): Promise<void>;

  /** All promotions (admin), ordered sortOrder ASC, createdAt DESC. */
  findAll(): Promise<PromotionRecord[]>;

  /** Live promotions at `now` (active + inside date window), same ordering. */
  findActive(now: Date): Promise<PromotionRecord[]>;
}
