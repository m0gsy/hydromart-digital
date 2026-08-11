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

export interface ResellerRepository {
  /** Registry rows, newest first. Filter by home depot and/or active flag. */
  list(filter: { homeDepotIds?: readonly string[]; active?: boolean }): Promise<Reseller[]>;
  findById(customerId: string): Promise<Reseller | null>;
  create(data: CreateResellerData): Promise<Reseller>;
  update(customerId: string, patch: UpdateResellerData): Promise<Reseller>;
}
