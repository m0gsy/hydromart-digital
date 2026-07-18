import { Inject, Injectable } from '@nestjs/common';

import { deriveMaintenanceStatus, MaintenanceItem } from '../../domain/maintenance';
import { DepotNotFoundError, MaintenanceItemNotFoundError } from '../../domain/errors';
import { DepotRepository } from '../ports/depot.repository';
import { MaintenanceRepository } from '../ports/maintenance.repository';
import { DEPOT_TOKENS } from '../tokens';

export interface CreateMaintenanceInput {
  depotId: string;
  name: string;
  category: string;
  intervalDays: number;
  nextDueAt: Date;
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
  ) {}

  private async requireDepot(depotId: string): Promise<void> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
  }

  // ponytail: status is derived on every read; the DB column is never trusted.
  private withStatus(item: MaintenanceItem, now: Date): MaintenanceItem {
    return { ...item, status: deriveMaintenanceStatus(item.nextDueAt, item.lastServicedAt, now) };
  }

  async create(input: CreateMaintenanceInput, now = new Date()): Promise<MaintenanceItem> {
    await this.requireDepot(input.depotId);
    const item = await this.items.create({
      depotId: input.depotId,
      name: input.name,
      category: input.category,
      intervalDays: input.intervalDays,
      lastServicedAt: input.lastServicedAt ?? null,
      nextDueAt: input.nextDueAt,
      note: input.note ?? null,
    });
    return this.withStatus(item, now);
  }

  async list(depotId: string, now = new Date()): Promise<MaintenanceItem[]> {
    await this.requireDepot(depotId);
    const items = await this.items.listForDepot(depotId);
    return items.map((i) => this.withStatus(i, now));
  }

  /** Mark serviced now: lastServicedAt = now, nextDueAt = now + intervalDays. */
  async markServiced(id: string, now = new Date()): Promise<MaintenanceItem> {
    const current = await this.items.findById(id);
    if (!current) throw new MaintenanceItemNotFoundError();
    const nextDueAt = new Date(now.getTime() + current.intervalDays * DAY_MS);
    const updated = await this.items.update(id, { lastServicedAt: now, nextDueAt });
    return this.withStatus(updated, now);
  }
}
