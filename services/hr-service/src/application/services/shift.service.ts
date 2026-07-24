import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess, depotScopeFilter } from '@hydromart/platform';

import { Shift } from '../../../prisma/generated/client';
import { SHIFT_REPOSITORY, ShiftRepository } from '../ports/shift.repository';

export interface ShiftInput {
  depotId?: string;
  name: string;
  startTime: string;
  endTime: string;
  active?: boolean;
}

/** Work shifts. MVP: attendance late-calc uses the depot's active shift start ?? config. */
@Injectable()
export class ShiftService {
  constructor(@Inject(SHIFT_REPOSITORY) private readonly repo: ShiftRepository) {}

  async list(user: AuthenticatedUser, depotIdParam?: string): Promise<Shift[]> {
    return this.repo.list(depotScopeFilter(user, depotIdParam) ?? undefined);
  }

  async create(user: AuthenticatedUser, input: ShiftInput): Promise<Shift> {
    if (input.depotId) assertDepotAccess(user, input.depotId);
    return this.repo.create({
      depotId: input.depotId ?? null,
      name: input.name,
      startTime: input.startTime,
      endTime: input.endTime,
      active: input.active ?? true,
    });
  }

  async update(user: AuthenticatedUser, id: string, input: Partial<ShiftInput>): Promise<Shift> {
    const shift = await this.repo.findById(id);
    if (!shift) throw new NotFoundException('Shift tidak ditemukan');
    if (shift.depotId) assertDepotAccess(user, shift.depotId);
    if (input.depotId) assertDepotAccess(user, input.depotId);
    return this.repo.update(id, {
      ...(input.depotId !== undefined ? { depotId: input.depotId } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
      ...(input.endTime !== undefined ? { endTime: input.endTime } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const shift = await this.repo.findById(id);
    if (!shift) throw new NotFoundException('Shift tidak ditemukan');
    if (shift.depotId) assertDepotAccess(user, shift.depotId);
    await this.repo.delete(id);
  }
}
