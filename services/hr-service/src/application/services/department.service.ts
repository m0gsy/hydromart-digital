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
