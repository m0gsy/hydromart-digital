import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess, depotScopeFilter } from '@hydromart/platform';

import { Employee, EmploymentHistory, Prisma, SalaryType } from '../../../prisma/generated/client';
import {
  EMPLOYEE_REPOSITORY,
  EmployeeRepository,
} from '../ports/employee.repository';

/** Fields whose transitions are worth an employment-history row (status/position/salary). */
const TRACKED: readonly (keyof Employee)[] = [
  'employmentStatus',
  'position',
  'status',
  'salaryType',
  'dailyRate',
  'monthlyRate',
  'depotId',
];

export interface CreateEmployeeInput {
  fullName: string;
  phone: string;
  email?: string;
  depotId: string;
  position: string;
  employmentStatus: Employee['employmentStatus'];
  joinDate: string;
  salaryType: SalaryType;
  dailyRate?: number;
  monthlyRate?: number;
  bankName?: string;
  bankAccount?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  authSubjectId?: string;
  photoUrl?: string;
}

export type UpdateEmployeeInput = Partial<CreateEmployeeInput> & {
  status?: Employee['status'];
};

@Injectable()
export class EmployeeService {
  constructor(@Inject(EMPLOYEE_REPOSITORY) private readonly repo: EmployeeRepository) {}

  async list(
    user: AuthenticatedUser,
    query: { depotId?: string; status?: Employee['status']; search?: string; page: number; pageSize: number },
  ): Promise<{ rows: Employee[]; total: number; page: number; pageSize: number }> {
    // Depot-locked roles (operator/manager) are forced to their own depot; HQ sees all.
    const depotId = depotScopeFilter(user, query.depotId);
    const { rows, total } = await this.repo.list({
      depotId,
      status: query.status,
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { rows, total, page: query.page, pageSize: query.pageSize };
  }

  async getById(user: AuthenticatedUser, id: string): Promise<Employee> {
    const employee = await this.repo.findById(id);
    if (!employee) {
      throw new NotFoundException('Karyawan tidak ditemukan');
    }
    // By-id endpoints carry no depotId for the guard to see — enforce here (see DepotScopeGuard note).
    assertDepotAccess(user, employee.depotId);
    return employee;
  }

  async getHistory(user: AuthenticatedUser, id: string): Promise<EmploymentHistory[]> {
    await this.getById(user, id); // 404 + depot check
    return this.repo.listHistory(id);
  }

  async create(user: AuthenticatedUser, input: CreateEmployeeInput): Promise<Employee> {
    // A depot-locked creator may only add staff to their own depot.
    assertDepotAccess(user, input.depotId);
    this.assertSalaryShape(input.salaryType, input.dailyRate, input.monthlyRate);

    const data: Omit<Prisma.EmployeeCreateInput, 'employeeCode'> = {
      fullName: input.fullName,
      phone: input.phone,
      email: input.email ?? null,
      depotId: input.depotId,
      position: input.position,
      employmentStatus: input.employmentStatus,
      joinDate: new Date(input.joinDate),
      salaryType: input.salaryType,
      dailyRate: input.salaryType === 'DAILY' ? (input.dailyRate ?? null) : null,
      monthlyRate: input.salaryType === 'MONTHLY' ? (input.monthlyRate ?? null) : null,
      bankName: input.bankName ?? null,
      bankAccount: input.bankAccount ?? null,
      emergencyName: input.emergencyName ?? null,
      emergencyPhone: input.emergencyPhone ?? null,
      authSubjectId: input.authSubjectId ?? null,
      photoUrl: input.photoUrl ?? null,
      createdBy: user.sub,
      updatedBy: user.sub,
    };

    const history: Prisma.EmploymentHistoryCreateWithoutEmployeeInput = {
      changeType: 'HIRED',
      toValue: { employmentStatus: input.employmentStatus, position: input.position },
      effectiveDate: new Date(input.joinDate),
      createdBy: user.sub,
    };

    // Sequential code (HR-0001). ponytail: retry on the unique-collision from a concurrent
    // create rather than a DB sequence; internal HR volume is low, add a sequence only if it bites.
    for (let attempt = 0; attempt < 5; attempt++) {
      const employeeCode = `HR-${String((await this.repo.count()) + 1 + attempt).padStart(4, '0')}`;
      try {
        return await this.repo.create({ ...data, employeeCode }, history);
      } catch (err) {
        if (this.isUniqueViolation(err, 'employeeCode') && attempt < 4) continue;
        if (this.isUniqueViolation(err, 'authSubjectId')) {
          throw new BadRequestException('Akun ini sudah tertaut ke karyawan lain');
        }
        throw err;
      }
    }
    /* istanbul ignore next — loop always returns or throws above */
    throw new BadRequestException('Gagal membuat kode karyawan, coba lagi');
  }

  async update(user: AuthenticatedUser, id: string, input: UpdateEmployeeInput): Promise<Employee> {
    const current = await this.getById(user, id); // 404 + depot check
    // Block moving an employee into a depot the caller can't touch.
    if (input.depotId) {
      assertDepotAccess(user, input.depotId);
    }

    const salaryType = input.salaryType ?? current.salaryType;
    const dailyRate = input.dailyRate ?? (current.dailyRate ? Number(current.dailyRate) : undefined);
    const monthlyRate =
      input.monthlyRate ?? (current.monthlyRate ? Number(current.monthlyRate) : undefined);
    if (input.salaryType || input.dailyRate != null || input.monthlyRate != null) {
      this.assertSalaryShape(salaryType, dailyRate, monthlyRate);
    }

    const data: Prisma.EmployeeUpdateInput = { updatedBy: user.sub };
    for (const key of [
      'fullName',
      'phone',
      'email',
      'position',
      'employmentStatus',
      'depotId',
      'bankName',
      'bankAccount',
      'emergencyName',
      'emergencyPhone',
      'authSubjectId',
      'photoUrl',
      'status',
    ] as const) {
      if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
    }
    if (input.joinDate !== undefined) data.joinDate = new Date(input.joinDate);
    if (input.salaryType !== undefined) data.salaryType = input.salaryType;
    if (input.salaryType || input.dailyRate != null || input.monthlyRate != null) {
      data.dailyRate = salaryType === 'DAILY' ? (dailyRate ?? null) : null;
      data.monthlyRate = salaryType === 'MONTHLY' ? (monthlyRate ?? null) : null;
    }

    const history = this.diffHistory(current, data, user.sub);
    return this.repo.update(id, data, history);
  }

  /** DAILY needs a dailyRate (no monthlyRate); MONTHLY the reverse. */
  private assertSalaryShape(type: SalaryType, dailyRate?: number, monthlyRate?: number): void {
    if (type === 'DAILY' && (dailyRate == null || dailyRate <= 0)) {
      throw new BadRequestException('dailyRate wajib diisi untuk tipe gaji DAILY');
    }
    if (type === 'MONTHLY' && (monthlyRate == null || monthlyRate <= 0)) {
      throw new BadRequestException('monthlyRate wajib diisi untuk tipe gaji MONTHLY');
    }
  }

  /** One history row per tracked field that actually changed value. */
  private diffHistory(
    current: Employee,
    data: Prisma.EmployeeUpdateInput,
    actor: string,
  ): Prisma.EmploymentHistoryCreateWithoutEmployeeInput[] {
    const rows: Prisma.EmploymentHistoryCreateWithoutEmployeeInput[] = [];
    for (const field of TRACKED) {
      const next = (data as Record<string, unknown>)[field];
      if (next === undefined) continue;
      const before = current[field];
      // Decimal/Date compare by string so a value-equal update logs nothing.
      if (before != null && String(before) === String(next)) continue;
      if (before == null && next == null) continue;
      rows.push({
        changeType: String(field),
        fromValue: before == null ? Prisma.JsonNull : { value: String(before) },
        toValue: next == null ? Prisma.JsonNull : { value: String(next) },
        effectiveDate: new Date(),
        createdBy: actor,
      });
    }
    return rows;
  }

  private isUniqueViolation(err: unknown, field: string): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      (err.meta?.target as string[] | undefined)?.includes(field) === true
    );
  }
}
