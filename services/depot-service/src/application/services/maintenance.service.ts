import { Inject, Injectable } from '@nestjs/common';

import { addLocalDays, localDayKey } from '@hydromart/platform';

import {
  deriveMaintenanceStatus,
  dueByOf,
  MaintenanceItem,
  MaintenanceItemView,
  MeterVolume,
} from '../../domain/maintenance';
import {
  DepotNotFoundError,
  MaintenanceIntervalRequiredError,
  MaintenanceItemNotFoundError,
} from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { MaintenanceRepository } from '../ports/maintenance.repository';
import { MeterRange, MeterVolumePort } from '../ports/meter-volume.port';
import { DEPOT_TOKENS } from '../tokens';

export interface CreateMaintenanceInput {
  depotId: string;
  name: string;
  category: string;
  intervalDays?: number | null;
  intervalM3?: number | null;
  /** Omitted: the last service (or now) plus `intervalDays`. Meaningless without a day interval. */
  nextDueAt?: Date | null;
  lastServicedAt?: Date | null;
  note?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Depot equipment/vehicle maintenance schedule (design depot admin). Health status is
 * always DERIVED from the next-due date at read time — the stored column is advisory.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(DEPOT_TOKENS.MaintenanceRepository) private readonly items: MaintenanceRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    @Inject(DEPOT_TOKENS.MeterVolume) private readonly meter: MeterVolumePort,
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.exists(depotId))) {
      throw new DepotNotFoundError();
    }
  }

  /**
   * Adds what the calendar and the meter say (HD-15). Volume since the service is the sum of
   * (closing - opening) over the COMPLETE WIB days after the service day up to yesterday: the
   * service day itself is partly before and partly after the service, and today has no closing
   * yet. A day without a closed reading adds nothing and is counted in `meterDaysMissing`, so the
   * figure is a floor, never an invention. Status is derived here every time; the column is advisory.
   */
  private async view<T extends MaintenanceItem>(
    items: readonly T[],
    now: Date,
  ): Promise<Array<T & MaintenanceItemView>> {
    const baseline = (i: MaintenanceItem): Date => i.lastServicedAt ?? i.createdAt;
    const yesterday = localDayKey(addLocalDays(now, -1));
    const ranges = new Map<string, MeterRange>();
    for (const i of items) {
      if (i.intervalM3 === null) continue;
      ranges.set(i.id, { depotId: i.depotId, from: localDayKey(addLocalDays(baseline(i), 1)), to: yesterday });
    }
    // A range that is empty (serviced today or yesterday) is zero litres without asking anyone.
    const toAsk = [...ranges.entries()].filter(([, r]) => r.from <= r.to);
    const answers = toAsk.length > 0 ? await this.meter.volumes(toAsk.map(([, r]) => r)) : [];
    const volume = new Map<string, MeterVolume | null>();
    for (const [id, r] of ranges) {
      volume.set(id, r.from > r.to ? { m3: 0, readingDays: 0, spanDays: 0 } : null);
    }
    toAsk.forEach(([id], k) => volume.set(id, answers[k] ?? null));
    return items.map((i) => {
      const v = volume.get(i.id) ?? null;
      const m3 = v ? v.m3 : null;
      const daysSinceService = Math.max(0, Math.floor((now.getTime() - baseline(i).getTime()) / DAY_MS));
      const dueBy = dueByOf(i, daysSinceService, m3, now);
      return {
        ...i,
        status: deriveMaintenanceStatus(i.nextDueAt, i.lastServicedAt, now, 14, dueBy === 'VOLUME'),
        daysSinceService,
        m3SinceService: m3,
        meterDaysMissing: v ? v.spanDays - v.readingDays : null,
        dueBy,
      };
    });
  }

  async create(input: CreateMaintenanceInput, now = new Date()): Promise<MaintenanceItemView> {
    await this.requireDepot(input.depotId);
    const intervalDays = input.intervalDays ?? null;
    const intervalM3 = input.intervalM3 ?? null;
    if (intervalDays === null && intervalM3 === null) throw new MaintenanceIntervalRequiredError();
    const nextDueAt =
      intervalDays === null
        ? null
        : (input.nextDueAt ??
          new Date((input.lastServicedAt ?? now).getTime() + intervalDays * DAY_MS));
    const item = await this.items.create({
      depotId: input.depotId,
      name: input.name,
      category: input.category,
      intervalDays,
      intervalM3,
      lastServicedAt: input.lastServicedAt ?? null,
      nextDueAt,
      note: input.note ?? null,
    });
    return (await this.view([item], now))[0];
  }

  async list(depotId: string, now = new Date()): Promise<MaintenanceItemView[]> {
    await this.requireDepot(depotId);
    return this.view(await this.items.listForDepot(depotId), now);
  }

  /**
   * HD-15: what is due or overdue anywhere, for the n8n "maintenance due" sweep (crm-service).
   * Items of closed depots are left out. `due` is only the items with a `dueBy`.
   */
  async due(now = new Date()): Promise<Array<MaintenanceItemView & { depotName: string }>> {
    const all = await this.items.listAllActive();
    const names = new Map(all.map((i) => [i.id, i.depotName]));
    return (await this.view(all, now))
      .filter((i) => i.dueBy !== null)
      .map((i) => ({ ...i, depotName: names.get(i.id) ?? '' }));
  }

  /** Load one item (for by-id depot-scope assertion in the controller). */
  async get(id: string): Promise<MaintenanceItem> {
    const found = await this.items.findById(id);
    if (!found) throw new MaintenanceItemNotFoundError();
    return found;
  }

  /** Mark serviced now: lastServicedAt = now, nextDueAt = now + intervalDays (none for a volume-only item). */
  async markServiced(id: string, now = new Date()): Promise<MaintenanceItemView> {
    const current = await this.items.findById(id);
    if (!current) throw new MaintenanceItemNotFoundError();
    const nextDueAt =
      current.intervalDays === null ? null : new Date(now.getTime() + current.intervalDays * DAY_MS);
    const updated = await this.items.update(id, { lastServicedAt: now, nextDueAt });
    return (await this.view([updated], now))[0];
  }
}
