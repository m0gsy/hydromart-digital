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
  decidedBy?: string | null;
  decisionReason?: string | null;
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
  /** Proposal count grouped by product, optionally filtered by status. */
  countByProduct(status?: PriceOverrideStatus): Promise<{ productId: string; count: number }[]>;
  findById(id: string): Promise<PriceOverrideProposalRecord | null>;
  update(id: string, patch: UpdatePriceOverrideProposalData): Promise<PriceOverrideProposalRecord>;
  /**
   * Compare-and-set: apply `patch` only while the proposal is still PENDING; null when another
   * decision got there first (D1-04). `update` after a status read lets two decisions both
   * pass the check and the last write win.
   */
  claimPending(
    id: string,
    patch: UpdatePriceOverrideProposalData,
  ): Promise<PriceOverrideProposalRecord | null>;
}
