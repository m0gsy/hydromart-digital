import { Inject, Injectable } from '@nestjs/common';

import { WholesaleTier } from '../../domain/wholesale-tier';
import { DepotNotFoundError, WholesaleTierNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import {
  UpdateWholesaleTierData,
  WholesaleTierRepository,
} from '../ports/wholesale-tier.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface CreateWholesaleTierInput {
  depotId: string;
  productId?: string | null;
  label: string;
  minQty: number;
  maxQty?: number | null;
  priceIdr: number;
}

/** Depot wholesale pricing tiers (design 16b): quantity-band pricing for bulk buyers. */
@Injectable()
export class WholesaleTierService {
  constructor(
    @Inject(DEPOT_TOKENS.WholesaleTierRepository)
    private readonly tiers: WholesaleTierRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  private async require(id: string): Promise<WholesaleTier> {
    const found = await this.tiers.findById(id);
    if (!found) throw new WholesaleTierNotFoundError();
    return found;
  }

  async create(input: CreateWholesaleTierInput): Promise<WholesaleTier> {
    await this.requireDepot(input.depotId);
    return this.tiers.create({
      depotId: input.depotId,
      productId: input.productId ?? null,
      label: input.label,
      minQty: input.minQty,
      maxQty: input.maxQty ?? null,
      priceIdr: input.priceIdr,
    });
  }

  async list(depotId: string): Promise<WholesaleTier[]> {
    await this.requireDepot(depotId);
    return this.tiers.listForDepot(depotId);
  }

  async update(id: string, patch: UpdateWholesaleTierData): Promise<WholesaleTier> {
    await this.require(id);
    return this.tiers.update(id, patch);
  }

  async remove(id: string): Promise<void> {
    await this.require(id);
    await this.tiers.delete(id);
  }
}
