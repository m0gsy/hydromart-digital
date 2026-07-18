import { WholesaleTier } from '../../domain/wholesale-tier';

export interface CreateWholesaleTierData {
  depotId: string;
  productId: string | null;
  label: string;
  minQty: number;
  maxQty: number | null;
  priceIdr: number;
}

/** Partial patch: label, band, price and/or active flag. */
export interface UpdateWholesaleTierData {
  label?: string;
  minQty?: number;
  maxQty?: number | null;
  priceIdr?: number;
  active?: boolean;
}

export interface WholesaleTierRepository {
  create(data: CreateWholesaleTierData): Promise<WholesaleTier>;
  /** A depot's tiers, ordered by minQty ascending. */
  listForDepot(depotId: string): Promise<WholesaleTier[]>;
  findById(id: string): Promise<WholesaleTier | null>;
  update(id: string, data: UpdateWholesaleTierData): Promise<WholesaleTier>;
  delete(id: string): Promise<void>;
}
