import { Inject, Injectable } from '@nestjs/common';

import { PromotionNotFoundError } from '../../domain/errors';
import {
  CreatePromotionData,
  PromotionRecord,
  PromotionRepository,
  UpdatePromotionData,
} from '../ports/promotion.repository';
import { PROMO_TOKENS } from '../tokens';

@Injectable()
export class PromotionService {
  constructor(
    @Inject(PROMO_TOKENS.PromotionRepository) private readonly repo: PromotionRepository,
  ) {}

  /** Live promotions for the customer Home page (active + inside date window). */
  listActive(now: Date = new Date()): Promise<PromotionRecord[]> {
    return this.repo.findActive(now);
  }

  /** All promotions incl. inactive/scheduled (admin). */
  listAll(): Promise<PromotionRecord[]> {
    return this.repo.findAll();
  }

  create(input: CreatePromotionData): Promise<PromotionRecord> {
    return this.repo.create(input);
  }

  async update(id: string, patch: UpdatePromotionData): Promise<PromotionRecord> {
    await this.getById(id);
    return this.repo.update(id, patch);
  }

  async remove(id: string): Promise<void> {
    await this.getById(id);
    await this.repo.delete(id);
  }

  private async getById(id: string): Promise<PromotionRecord> {
    const promotion = await this.repo.findById(id);
    if (!promotion) throw new PromotionNotFoundError();
    return promotion;
  }
}
