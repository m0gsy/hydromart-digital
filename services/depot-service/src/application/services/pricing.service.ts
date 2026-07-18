import { Inject, Injectable } from '@nestjs/common';

import { PricingAdjustType, PricingRuleRecord, resolveRule } from '../../domain/pricing-rule';
import {
  DepotNotFoundError,
  InvalidPricingWindowError,
  PricingRuleNotFoundError,
} from '../../domain/errors';
import {
  PricingRuleRepository,
  UpdatePricingRuleData,
} from '../ports/pricing-rule.repository';
import { InventoryRepository } from '../ports/inventory.repository';
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
}

@Injectable()
export class PricingService {
  constructor(
    @Inject(DEPOT_TOKENS.PricingRuleRepository) private readonly rules: PricingRuleRepository,
    @Inject(DEPOT_TOKENS.InventoryRepository) private readonly inventory: InventoryRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
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
  async resolvePrices(
    depotId: string,
    productIds: string[],
    now: Date = new Date(),
  ): Promise<ResolvedProductPrice[]> {
    if (productIds.length === 0) return [];
    const [overrides, activeRules] = await Promise.all([
      this.inventory.findPrices(depotId, productIds),
      this.rules.listActiveForDepot(depotId),
    ]);
    const overrideByProduct = new Map(overrides.map((o) => [o.productId, o.sellPrice]));
    const tz = this.config.pricingTimeZone;

    const out: ResolvedProductPrice[] = [];
    for (const productId of productIds) {
      const sellPrice = overrideByProduct.get(productId);
      const rule = resolveRule(activeRules, productId, now, tz);
      if (sellPrice === undefined && !rule) continue;
      out.push({
        productId,
        ...(sellPrice !== undefined ? { sellPrice } : {}),
        ...(rule ? { adjustType: rule.adjustType, value: rule.value } : {}),
      });
    }
    return out;
  }
}
