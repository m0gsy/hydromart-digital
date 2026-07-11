import { PricingAdjustType, PricingRuleRecord } from '../../domain/pricing-rule';

export interface CreatePricingRuleData {
  depotId: string;
  productId: string | null;
  adjustType: PricingAdjustType;
  value: number;
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  priority: number;
  active: boolean;
}

export interface UpdatePricingRuleData {
  productId?: string | null;
  adjustType?: PricingAdjustType;
  value?: number;
  daysOfWeek?: number[];
  startMinute?: number | null;
  endMinute?: number | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  priority?: number;
  active?: boolean;
}

export interface PricingRuleRepository {
  create(data: CreatePricingRuleData): Promise<PricingRuleRecord>;
  findById(id: string): Promise<PricingRuleRecord | null>;
  /** All rules for a depot (incl. inactive) for the admin console. */
  listForDepot(depotId: string): Promise<PricingRuleRecord[]>;
  /** Only enabled rules; time-window filtering happens in the domain. */
  listActiveForDepot(depotId: string): Promise<PricingRuleRecord[]>;
  update(id: string, patch: UpdatePricingRuleData): Promise<PricingRuleRecord>;
  delete(id: string): Promise<void>;
}
