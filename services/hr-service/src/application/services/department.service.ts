import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess, depotScopeIds } from '@hydromart/platform';

import { Department, Prisma } from '../../../prisma/generated/client';
import { DEPARTMENT_REPOSITORY, DepartmentRepository } from '../ports/department.repository';

export interface DepartmentInput {
  code: string;
  name: string;
  depotId?: string;
  active?: boolean;
}

/** Org units. A null depotIds is network-wide (Finance, HR); otherwise it belongs to one depot. */
@Injectable()
export class DepartmentService {
  constructor(@Inject(DEPARTMENT_REPOSITORY) private readonly repo: DepartmentRepository) {}

  async list(user: AuthenticatedUser, depotIdParam?: string): Promise<Department[]> {
    return this.repo.list(depotScopeIds(user, depotIdParam) ?? undefined);
  }

  async create(user: AuthenticatedUser, input: DepartmentInput): Promise<Department> {
    if (input.depotId) assertDepotAccess(user, input.depotId);
    return this.guardCode(() =>
      this.repo.create({
        code: input.code.trim().toUpperCase(),
        name: input.name,
        depotId: input.depotId ?? null,
        active: input.active ?? true,
      }),
    );
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: Partial<DepartmentInput>,
  ): Promise<Department> {
    const department = await this.get(id);
    if (department.depotId) assertDepotAccess(user, department.depotId);
    if (input.depotId) assertDepotAccess(user, input.depotId);
    return this.guardCode(() =>
      this.repo.update(id, {
        ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.depotId !== undefined ? { depotId: input.depotId } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      }),
    );
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const department = await this.get(id);
    if (department.depotId) assertDepotAccess(user, department.depotId);
    /*
     * CA-1-12 — the delete had no reference check on either side of the wire.
     *
     * `Employee.departmentId` is a plain UUID, deliberately (same service, no relation
     * nav), which means the database will not stop this: the department row goes, the
     * employee rows keep pointing at an id that no longer exists, and every one of those
     * people reads as "Belum diatur" on the roster. Nothing records that they were in a
     * unit at all, so there is no way back except from a backup.
     *
     * Refuse instead, and say how many. Deactivating (`active: false`) is the operation
     * that was actually wanted: it hides the unit from the pickers and keeps the history.
     */
    const inUse = await this.repo.countEmployees(id);
    if (inUse > 0) {
      throw new ConflictException(
        `Departemen masih dipakai ${inUse} karyawan. Pindahkan mereka dulu, atau nonaktifkan departemennya.`,
      );
    }
    await this.repo.delete(id);
  }

  private async get(id: string): Promise<Department> {
    const department = await this.repo.findById(id);
    if (!department) throw new NotFoundException('Departemen tidak ditemukan');
    return department;
  }

  /** `code` is the key the import sheet types, so a clash must read as a clash, not a 500. */
  private async guardCode(write: () => Promise<Department>): Promise<Department> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Kode departemen sudah dipakai');
      }
      throw err;
    }
  }
}
