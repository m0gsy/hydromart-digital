import { Inject, Injectable } from '@nestjs/common';

import { PricingAdjustType, PricingRuleRecord, resolveRule } from '../../domain/pricing-rule';
import {
  DepotNotFoundError,
  InvalidPricingWindowError,
  PricingRuleNotFoundError,
} from '../../domain/errors';
import { PricingRuleRepository, UpdatePricingRuleData } from '../ports/pricing-rule.repository';
import { InventoryRepository } from '../ports/inventory.repository';
import { WholesaleTierRepository } from '../ports/wholesale-tier.repository';
import { pickTierPrice } from '../../domain/wholesale-tier';
import { DepotRepository } from '../ports/depot.repository';
import { DepotConfigService } from '../../config/depot-config.service';
import { DEPOT_TOKENS } from '../tokens';

export interface CreateRuleInput {
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

export interface ResolvedProductPrice {
  productId: string;
  sellPrice?: number;
  adjustType?: PricingAdjustType;
  value?: number;
  /**
   * Wholesale band price for the quantity the caller asked about (design 16b). Present
   * only when a tier matches; it is an absolute unit price, so a caller that honours it
   * must ignore `sellPrice` and the rule adjustment for that line.
   */
  tierPrice?: number;
}

@Injectable()
export class PricingService {
  constructor(
    @Inject(DEPOT_TOKENS.PricingRuleRepository) private readonly rules: PricingRuleRepository,
    @Inject(DEPOT_TOKENS.InventoryRepository) private readonly inventory: InventoryRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    @Inject(DEPOT_TOKENS.WholesaleTierRepository)
    private readonly tiers: WholesaleTierRepository,
    private readonly config: DepotConfigService,
  ) {}

  private validateWindow(input: {
    startMinute: number | null;
    endMinute: number | null;
    validFrom: Date | null;
    validUntil: Date | null;
  }): void {
    if (
      input.startMinute !== null &&
      input.endMinute !== null &&
      input.endMinute <= input.startMinute
    ) {
      throw new InvalidPricingWindowError('End time must be after start time.');
    }
    if (input.validFrom && input.validUntil && input.validUntil < input.validFrom) {
      throw new InvalidPricingWindowError('Valid-until must not precede valid-from.');
    }
  }

  async create(depotId: string, input: CreateRuleInput): Promise<PricingRuleRecord> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    this.validateWindow(input);
    return this.rules.create({ depotId, ...input });
  }

  async list(depotId: string): Promise<PricingRuleRecord[]> {
    return this.rules.listForDepot(depotId);
  }

  /** Load one rule (for by-id depot-scope assertion in the controller). */
  async get(id: string): Promise<PricingRuleRecord> {
    const found = await this.rules.findById(id);
    if (!found) throw new PricingRuleNotFoundError();
    return found;
  }

  async update(id: string, patch: UpdatePricingRuleData): Promise<PricingRuleRecord> {
    const existing = await this.rules.findById(id);
    if (!existing) {
      throw new PricingRuleNotFoundError();
    }
    this.validateWindow({
      startMinute: patch.startMinute ?? existing.startMinute,
      endMinute: patch.endMinute ?? existing.endMinute,
      validFrom: patch.validFrom ?? existing.validFrom,
      validUntil: patch.validUntil ?? existing.validUntil,
    });
    return this.rules.update(id, patch);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.rules.findById(id);
    if (!existing) {
      throw new PricingRuleNotFoundError();
    }
    await this.rules.delete(id);
  }

  /**
   * Per-product resolved pricing for checkout: the static sellPrice override (if any)
   * plus the single winning active rule (if any). A product with neither is omitted;
   * order-service then falls back to the catalog base price.
   */
  /**
   * `quantities` is positional against `productIds`; a quantity of 0/absent means the
   * caller only wants the unit price and no wholesale band is considered.
   */
  async resolvePrices(
    depotId: string,
    productIds: string[],
    now: Date = new Date(),
    quantities: number[] = [],
  ): Promise<ResolvedProductPrice[]> {
    if (productIds.length === 0) return [];
    const wantsTiers = quantities.some((q) => q > 0);
    const [overrides, activeRules, tiers] = await Promise.all([
      this.inventory.findPrices(depotId, productIds),
      this.rules.listActiveForDepot(depotId),
      wantsTiers ? this.tiers.listForDepot(depotId) : Promise.resolve([]),
    ]);
    const overrideByProduct = new Map(overrides.map((o) => [o.productId, o.sellPrice]));
    const tz = this.config.pricingTimeZone;

    const out: ResolvedProductPrice[] = [];
    productIds.forEach((productId, i) => {
      const sellPrice = overrideByProduct.get(productId);
      const rule = resolveRule(activeRules, productId, now, tz);
      const qty = quantities[i] ?? 0;
      const tierPrice = qty > 0 ? pickTierPrice(tiers, productId, qty) : undefined;
      if (sellPrice === undefined && !rule && tierPrice === undefined) return;
      out.push({
        productId,
        ...(sellPrice !== undefined ? { sellPrice } : {}),
        ...(rule ? { adjustType: rule.adjustType, value: rule.value } : {}),
        ...(tierPrice !== undefined ? { tierPrice } : {}),
      });
    });
    return out;
  }
}
