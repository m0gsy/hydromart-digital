import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  assertFresh,
  isDecisionOnlyPatch,
  pointInServiceArea,
  readServiceArea,
} from '@hydromart/platform';

import {
  DepotOwnerShare,
  assertValidOwners,
  primaryOwnerId,
  soleOwner,
} from '../../domain/depot-owners';
import { OwnershipType } from '../../domain/inventory';
import {
  DepotNotFoundError,
  DuplicateDepotCodeError,
  FranchiseOwnerRequiredError,
} from '../../domain/errors';
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
  /** Only these depots — a depot-scoped caller's set. Empty means none, not all. */
  depotIds?: readonly string[];
  /** Only depots this franchise owner owns. */
  ownerId?: string;
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

/** Current owners of a record, falling back to the mirrored primary for rows read without them. */
function currentOwners(depot: DepotRecord): DepotOwnerShare[] {
  if (depot.owners) return depot.owners;
  return depot.ownerId ? soleOwner(depot.ownerId) : [];
}

/** Same owners, same shares, same primary - order aside. */
function sameOwners(a: readonly DepotOwnerShare[], b: readonly DepotOwnerShare[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((o) => [o.ownerId, o]));
  return a.every((o) => {
    const other = byId.get(o.ownerId);
    return other !== undefined && other.sharePct === o.sharePct && other.isPrimary === o.isPrimary;
  });
}

/** Depot management (PRD FR-075..080): public browse + admin CRUD. Delete = soft. */
@Injectable()
export class DepotService {
  private static readonly MAX_LIMIT = 100;
  private static readonly NEARBY_MAX = 50;
  // ponytail: single unpaged scan of active depots; fine into the low thousands, see findNearby.
  private static readonly NEARBY_SCAN_LIMIT = 5000;

  constructor(@Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository) {}

  async browse(input: BrowseDepotsInput, activeOnly: boolean): Promise<Page<DepotRecord>> {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(DepotService.MAX_LIMIT, Math.max(1, input.limit ?? 20));
    const { items, total } = await this.depots.search({
      page,
      limit,
      ownershipType: input.ownershipType,
      search: input.search?.trim() || undefined,
      depotIds: input.depotIds,
      ownerId: input.ownerId,
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
    // `owners` wins; the legacy single `ownerId` means one owner taking 100%.
    const given: DepotOwnerShare[] = data.owners ?? (data.ownerId ? soleOwner(data.ownerId) : []);
    if (data.ownershipType === OwnershipType.WARALABA && given.length === 0) {
      throw new FranchiseOwnerRequiredError();
    }
    const owners = given.length > 0 ? assertValidOwners(given) : [];
    if (await this.depots.findByCode(data.code)) {
      throw new DuplicateDepotCodeError();
    }
    return this.depots.create({ ...data, owners, ownerId: primaryOwnerId(owners) });
  }

  /**
   * CA-2-53: refused when the caller's copy is older than the stored depot. The bank
   * account on this record is where a depot's money is paid, and two people editing it
   * used to produce whichever of them saved last.
   */
  async update(
    id: string,
    patch: UpdateDepotData,
    seenUpdatedAt?: string,
    canChangeOwners = true,
  ): Promise<DepotRecord> {
    const current = await this.get(id, false);
    if (!isDecisionOnlyPatch(patch)) assertFresh(current.updatedAt, seenUpdatedAt);
    // Judged on the depot as it will be AFTER the patch: flipping HKP → WARALABA without
    // naming an owner, or clearing the owner of a franchise depot, both break the money path.
    const ownershipType = patch.ownershipType ?? current.ownershipType;
    const nextOwners = this.ownersAfter(current, patch);
    // Who is paid, and how much, is not a depot setting: editing a depot is open to its manager,
    // changing its owners is head office's (the same people who may create or deactivate one).
    if (nextOwners !== undefined && !canChangeOwners) {
      throw new ForbiddenException(
        'Hanya kantor pusat yang boleh mengubah pemilik dan pembagian hasil depot.',
      );
    }
    const effective = nextOwners ?? currentOwners(current);
    if (ownershipType === OwnershipType.WARALABA && effective.length === 0) {
      throw new FranchiseOwnerRequiredError();
    }
    if (patch.code) {
      const owner = await this.depots.findByCode(patch.code);
      if (owner && owner.id !== id) {
        throw new DuplicateDepotCodeError();
      }
    }
    // Ownership goes through `nextOwners` alone: a raw ownerId/owners must never reach the repository.
    const rest = { ...patch };
    delete rest.ownerId;
    delete rest.owners;
    return this.depots.update(
      id,
      nextOwners ? { ...rest, owners: nextOwners, ownerId: primaryOwnerId(nextOwners) } : rest,
    );
  }

  /**
   * The owner set a patch asks for, or undefined when it leaves ownership alone.
   *
   * `owners` replaces the set. A bare `ownerId` is the old single-owner form and replaces it
   * with one owner at 100% - EXCEPT when it names the current primary, which is what every
   * older edit form sends on each save: treating that as "reset to sole owner" would silently
   * wipe a depot's co-owners and their shares the next time anyone fixed a typo in its address.
   */
  private ownersAfter(current: DepotRecord, patch: UpdateDepotData): DepotOwnerShare[] | undefined {
    if (patch.owners !== undefined) {
      const next = patch.owners.length > 0 ? assertValidOwners(patch.owners) : [];
      // An edit form resends the whole owner list on every save. Unchanged is not a change of
      // owners: it must neither open a new generation nor be refused to a manager.
      return sameOwners(next, currentOwners(current)) ? undefined : next;
    }
    if (patch.ownerId === undefined) return undefined;
    if (patch.ownerId === null) return [];
    if (patch.ownerId === current.ownerId) return undefined;
    return assertValidOwners(soleOwner(patch.ownerId));
  }

  /** The owners that applied at `asOf` (default now), for the money path. */
  async ownersAsOf(id: string, asOf: Date = new Date()): Promise<DepotOwnerShare[]> {
    const depot = await this.get(id, false);
    const found = await this.depots.ownersAsOf(id, asOf);
    // A moment before any generation was recorded: the depot's current set is the best answer.
    return found.length > 0 ? found : currentOwners(depot);
  }

  /**
   * Active depots nearest to (lat,lng), nearest first, each annotated with distance and whether
   * the caller falls inside that depot's service area: its drawn polygons when it has any,
   * otherwise its service radius. order-service makes the same call at checkout, with the
   * same `pointInServiceArea`, so this list and the order that follows cannot disagree.
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
        const area = readServiceArea(d.serviceArea);
        return {
          ...d,
          distanceKm,
          withinService: area
            ? pointInServiceArea({ lat, lng }, area)
            : d.serviceRadiusKm != null && distanceKm <= d.serviceRadiusKm,
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, take);
  }

  /**
   * EVERY active depot, paged past `browse`'s 100-row cap.
   *
   * `browse({ limit: 1000 })` silently clamps to MAX_LIMIT, so a caller that has to reach
   * all of them — the SOP sales broadcast — would quietly stop at the hundredth depot and
   * look like it had covered the network. Bounded by the reported `total`, so it cannot
   * spin if a page comes back empty.
   */
  async listAllActive(): Promise<DepotRecord[]> {
    const out: DepotRecord[] = [];
    for (let page = 1; ; page++) {
      const { items, total } = await this.depots.search({
        page,
        limit: DepotService.MAX_LIMIT,
        activeOnly: true,
      });
      out.push(...items);
      if (items.length === 0 || out.length >= total) return out;
    }
  }

  /**
   * The depots behind a list of ids, in the order the ids arrive.
   *
   * Active AND inactive on purpose: these are the caller's OWN depots, and a depot that was
   * deactivated yesterday is exactly the one its kepala depot needs to still be able to open.
   * Rows that do not exist are simply absent — a stale id in a resolved scope is not an error.
   */
  async listByIds(ids: string[]): Promise<DepotRecord[]> {
    if (ids.length === 0) return [];
    const found = await this.depots.findManyByIds(ids, false);
    const byId = new Map(found.map((d) => [d.id, d]));
    return ids.map((id) => byId.get(id)).filter((d): d is DepotRecord => d !== undefined);
  }

  /** Depots managed by a franchise owner (active and inactive — an owner manages their own). */
  async listMine(ownerId: string): Promise<DepotRecord[]> {
    return this.depots.findByOwner(ownerId);
  }

  /**
   * CA-2-53: the QRIS image upload is not a form edit, so it carries no version.
   *
   * It replaces exactly one field with a file the caller just uploaded — there is no
   * second admin's typing to erase, and refusing it for want of a stamp would break an
   * upload that has always worked. A narrow method says that out loud instead of letting
   * the guarded `update` be called with nothing to compare.
   */
  async setQrisImage(id: string, paymentQrisImageUrl: string): Promise<DepotRecord> {
    await this.get(id, false);
    return this.depots.update(id, { paymentQrisImageUrl });
  }

  /** Soft delete. */
  async deactivate(id: string): Promise<DepotRecord> {
    await this.get(id, false);
    return this.depots.update(id, { active: false });
  }
}
