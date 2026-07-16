import { PricingAdjustType } from '../../domain/pricing-rule';
import {
  PriceOverrideProposalRecord,
  PriceOverrideStatus,
} from '../../domain/price-override-proposal';

export interface CreatePriceOverrideProposalData {
  depotId: string;
  depotName: string;
  productId: string;
  productName: string;
  currentPrice: number;
  adjustType: PricingAdjustType;
  value: number;
  note: string | null;
  proposedBy: string;
}

export interface UpdatePriceOverrideProposalData {
  status?: PriceOverrideStatus;
  decidedBy?: string;
}

export interface ListProposalsFilter {
  page: number;
  limit: number;
  status?: PriceOverrideStatus;
}

export interface PriceOverrideProposalRepository {
  create(data: CreatePriceOverrideProposalData): Promise<PriceOverrideProposalRecord>;
  /** Queue read: newest first, optionally filtered by status (HQ defaults to PENDING). */
  list(
    filter: ListProposalsFilter,
  ): Promise<{ items: PriceOverrideProposalRecord[]; total: number }>;
  findById(id: string): Promise<PriceOverrideProposalRecord | null>;
  update(
    id: string,
    patch: UpdatePriceOverrideProposalData,
  ): Promise<PriceOverrideProposalRecord>;
}
