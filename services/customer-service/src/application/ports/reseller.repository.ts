export interface Reseller {
  customerId: string;
  homeDepotId: string;
  monthlyTargetQty: number;
  discountPct: number;
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
  joinDate: Date;
  note?: string | null;
}

export interface UpdateResellerData {
  homeDepotId?: string;
  monthlyTargetQty?: number;
  discountPct?: number;
  active?: boolean;
  note?: string | null;
}

export interface ResellerRepository {
  /** Registry rows, newest first. Filter by home depot and/or active flag. */
  list(filter: { homeDepotIds?: readonly string[]; active?: boolean }): Promise<Reseller[]>;
  findById(customerId: string): Promise<Reseller | null>;
  create(data: CreateResellerData): Promise<Reseller>;
  update(customerId: string, patch: UpdateResellerData): Promise<Reseller>;
}
