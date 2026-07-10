import { Inject, Injectable } from '@nestjs/common';

import { OwnershipType } from '../../domain/inventory';
import { DepotNotFoundError, DuplicateDepotCodeError } from '../../domain/errors';
import { Page, buildPage } from '../pagination';
import {
  CreateDepotData,
  DepotRecord,
  DepotRepository,
  UpdateDepotData,
} from '../ports/depot.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface BrowseDepotsInput {
  page?: number;
  limit?: number;
  ownershipType?: OwnershipType;
  search?: string;
}

/** Depot management (PRD FR-075..080): public browse + admin CRUD. Delete = soft. */
@Injectable()
export class DepotService {
  private static readonly MAX_LIMIT = 100;

  constructor(
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  async browse(input: BrowseDepotsInput, activeOnly: boolean): Promise<Page<DepotRecord>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(DepotService.MAX_LIMIT, Math.max(1, input.limit ?? 20));
    const { items, total } = await this.depots.search({
      page,
      limit,
      ownershipType: input.ownershipType,
      search: input.search?.trim() || undefined,
      activeOnly,
    });
    return buildPage(items, total, page, limit);
  }

  async get(id: string, activeOnly: boolean): Promise<DepotRecord> {
    const depot = await this.depots.findById(id, activeOnly);
    if (!depot) {
      throw new DepotNotFoundError();
    }
    return depot;
  }

  async create(data: CreateDepotData): Promise<DepotRecord> {
    if (await this.depots.findByCode(data.code)) {
      throw new DuplicateDepotCodeError();
    }
    return this.depots.create(data);
  }

  async update(id: string, patch: UpdateDepotData): Promise<DepotRecord> {
    await this.get(id, false);
    if (patch.code) {
      const owner = await this.depots.findByCode(patch.code);
      if (owner && owner.id !== id) {
        throw new DuplicateDepotCodeError();
      }
    }
    return this.depots.update(id, patch);
  }

  /** Depots managed by a franchise owner (active and inactive — an owner manages their own). */
  async listMine(ownerId: string): Promise<DepotRecord[]> {
    return this.depots.findByOwner(ownerId);
  }

  /** Soft delete. */
  async deactivate(id: string): Promise<DepotRecord> {
    await this.get(id, false);
    return this.depots.update(id, { active: false });
  }
}
