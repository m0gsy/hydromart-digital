import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess, depotScopeIds } from '@hydromart/platform';

import { Prisma, Shift, ShiftAssignment, ShiftRotation } from '../../../prisma/generated/client';
import { SHIFT_REPOSITORY, ShiftRepository } from '../ports/shift.repository';
import { EmployeeService } from './employee.service';

export interface ShiftInput {
  depotId?: string;
  name: string;
  startTime: string;
  endTime: string;
  active?: boolean;
}

export interface RotationInput {
  name: string;
  depotId?: string;
  /** Weekday (0 = Sunday) to Shift.id. Omitted or null = day off. */
  pattern: Record<string, string | null>;
  active?: boolean;
}

export interface AssignmentInput {
  employeeId: string;
  shiftId?: string;
  rotationId?: string;
  /** ISO date; the assignment applies from this day onward until a newer one starts. */
  effectiveFrom: string;
  note?: string;
}

/**
 * Work shifts, weekly rotations, and who is on which. Attendance reads the assignment when
 * deciding whether a punch is late — see domain/shift-rotation.ts for the precedence.
 */
@Injectable()
export class ShiftService {
  constructor(
    @Inject(SHIFT_REPOSITORY) private readonly repo: ShiftRepository,
    private readonly employees: EmployeeService,
  ) {}

  async list(user: AuthenticatedUser, depotIdParam?: string): Promise<Shift[]> {
    return this.repo.list(depotScopeIds(user, depotIdParam) ?? undefined);
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

  // ── rotations (C3) ──────────────────────────────────────────────────

  async listRotations(user: AuthenticatedUser, depotIdParam?: string): Promise<ShiftRotation[]> {
    return this.repo.listRotations(depotScopeIds(user, depotIdParam) ?? undefined);
  }

  async createRotation(user: AuthenticatedUser, input: RotationInput): Promise<ShiftRotation> {
    if (input.depotId) assertDepotAccess(user, input.depotId);
    return this.repo.createRotation({
      name: input.name,
      depotId: input.depotId ?? null,
      pattern: this.cleanPattern(input.pattern) as Prisma.InputJsonValue,
      active: input.active ?? true,
    });
  }

  async updateRotation(
    user: AuthenticatedUser,
    id: string,
    input: Partial<RotationInput>,
  ): Promise<ShiftRotation> {
    const rotation = await this.repo.findRotationById(id);
    if (!rotation) throw new NotFoundException('Rotasi shift tidak ditemukan');
    if (rotation.depotId) assertDepotAccess(user, rotation.depotId);
    if (input.depotId) assertDepotAccess(user, input.depotId);
    return this.repo.updateRotation(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.depotId !== undefined ? { depotId: input.depotId } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.pattern !== undefined
        ? { pattern: this.cleanPattern(input.pattern) as Prisma.InputJsonValue }
        : {}),
    });
  }

  // ── assignments (C3) ────────────────────────────────────────────────

  /** Append a new assignment. Nothing is edited: the old one stays as history. */
  async assign(user: AuthenticatedUser, input: AssignmentInput): Promise<ShiftAssignment> {
    await this.employees.getById(user, input.employeeId); // 404 + depot check
    if (!input.shiftId === !input.rotationId) {
      // Both or neither: there would be no single answer to "which shift today?".
      throw new BadRequestException('Isi salah satu: shiftId atau rotationId');
    }
    if (input.shiftId && !(await this.repo.findById(input.shiftId))) {
      throw new NotFoundException('Shift tidak ditemukan');
    }
    if (input.rotationId && !(await this.repo.findRotationById(input.rotationId))) {
      throw new NotFoundException('Rotasi shift tidak ditemukan');
    }
    const effectiveFrom = new Date(`${input.effectiveFrom.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new BadRequestException('effectiveFrom bukan tanggal yang sah');
    }
    return this.repo.assign({
      employeeId: input.employeeId,
      shiftId: input.shiftId ?? null,
      rotationId: input.rotationId ?? null,
      effectiveFrom,
      note: input.note ?? null,
      createdBy: user.sub,
    });
  }

  async listAssignments(user: AuthenticatedUser, employeeId: string): Promise<ShiftAssignment[]> {
    await this.employees.getById(user, employeeId); // 404 + depot check
    return this.repo.listAssignments(employeeId);
  }

  /** Weekday keys only, blank shift ids normalised to null (a day off). */
  private cleanPattern(pattern: Record<string, string | null>): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(pattern)) {
      const day = Number(key);
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      out[String(day)] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    }
    return out;
  }
}
