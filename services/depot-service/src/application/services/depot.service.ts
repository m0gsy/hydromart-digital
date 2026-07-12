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

export interface NearbyDepot extends DepotRecord {
  distanceKm: number;
  withinService: boolean;
}

/** Great-circle distance (km) between two lat/lng points. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371; // Earth mean radius, km
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Depot management (PRD FR-075..080): public browse + admin CRUD. Delete = soft. */
@Injectable()
export class DepotService {
  private static readonly MAX_LIMIT = 100;
  private static readonly NEARBY_MAX = 50;
  // ponytail: single unpaged scan of active depots; fine into the low thousands, see findNearby.
  private static readonly NEARBY_SCAN_LIMIT = 5000;

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

  /**
   * Active depots nearest to (lat,lng), nearest first, each annotated with distance and whether
   * the caller falls inside that depot's service radius.
   */
  async findNearby(lat: number, lng: number, limit: number): Promise<NearbyDepot[]> {
    const take = Math.min(DepotService.NEARBY_MAX, Math.max(1, limit || 10));
    // ponytail: in-app haversine over active depots; move to PostGIS if depot count crosses ~thousands
    const { items } = await this.depots.search({
      page: 1,
      limit: DepotService.NEARBY_SCAN_LIMIT,
      activeOnly: true,
    });
    return items
      .filter((d) => d.lat != null && d.lng != null)
      .map((d) => {
        const distanceKm = haversineKm(lat, lng, d.lat, d.lng);
        return {
          ...d,
          distanceKm,
          withinService: d.serviceRadiusKm != null && distanceKm <= d.serviceRadiusKm,
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, take);
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
