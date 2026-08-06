import { Injectable } from '@nestjs/common';

import { depotWhere } from '@hydromart/platform';
import { Employee, EmploymentHistory, Prisma } from '../../../prisma/generated/client';


import {
  EmployeeListFilter,
  EmployeeRepository,
} from '../../application/ports/employee.repository';
import { PrismaService } from './prisma.service';


/**
 * How many rows sharing one phone the invite lookup will read. A family number covers a
 * handful of people at most; the cap is here so a data-entry accident cannot turn one
 * lookup into a table scan, not because 25 is a meaningful business number.
 */
const SHARED_PHONE_CAP = 25;

@Injectable()
export class EmployeePrismaRepository implements EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  count(): Promise<number> {
    return this.prisma.employee.count();
  }

  /** Tombstone written over a departed employee's identity. Not blank — a blank name
   * reads as a data bug to whoever opens an old payroll slip. */
  private static readonly REDACTED = 'Karyawan dihapus';

  async anonymiseRetentionEligible(cutoff: Date): Promise<number> {
    const doomed = await this.prisma.employee.findMany({
      where: { status: { in: ['RESIGNED', 'INACTIVE'] }, updatedAt: { lt: cutoff } },
      select: { id: true },
    });
    if (doomed.length === 0) return 0;
    const ids = doomed.map((e) => e.id);

    // One transaction: an employee whose identity was scrubbed but whose face embedding
    // survived would be the worst of both outcomes.
    await this.prisma.$transaction([
      this.prisma.faceEmbedding.deleteMany({ where: { employeeId: { in: ids } } }),
      this.prisma.attendance.deleteMany({ where: { employeeId: { in: ids } } }),
      this.prisma.performanceReview.deleteMany({ where: { employeeId: { in: ids } } }),
      this.prisma.employee.updateMany({
        where: { id: { in: ids } },
        data: {
          fullName: EmployeePrismaRepository.REDACTED,
          // employeeCode is UNIQUE and referenced by payroll history, so it stays; it
          // identifies a row, not a person.
          phone: '-',
          email: null,
          photoUrl: null,
          authSubjectId: null,
        },
      }),
    ]);
    return ids.length;
  }

  /**
   * The same scrub for ONE employee, triggered by HQ deleting their account rather than by
   * the retention cutoff. Identical split, deliberately: biometrics, attendance and reviews
   * go; payroll, bonuses, deductions and loans stay ownerless under the 10-year FINANCIAL
   * rule. Reusing the shape means "deleted" means one thing here, not two.
   */
  async anonymiseByAuthSubjectId(authSubjectId: string): Promise<number> {
    const employee = await this.prisma.employee.findUnique({
      where: { authSubjectId },
      select: { id: true },
    });
    if (!employee) return 0;

    await this.prisma.$transaction([
      this.prisma.faceEmbedding.deleteMany({ where: { employeeId: employee.id } }),
      this.prisma.attendance.deleteMany({ where: { employeeId: employee.id } }),
      this.prisma.performanceReview.deleteMany({ where: { employeeId: employee.id } }),
      this.prisma.employee.update({
        where: { id: employee.id },
        data: {
          fullName: EmployeePrismaRepository.REDACTED,
          phone: '-',
          email: null,
          photoUrl: null,
          authSubjectId: null,
          status: 'RESIGNED',
        },
      }),
    ]);
    return 1;
  }

  async purgeFaceEmbeddings(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.faceEmbedding.deleteMany({
      where: {
        employee: { status: { in: ['RESIGNED', 'INACTIVE'] }, updatedAt: { lt: cutoff } },
      },
    });
    return count;
  }

  countRetentionEligible(cutoff: Date): Promise<number> {
    // `updatedAt` is the only dormancy clock the schema has — there is no resignedAt —
    // so a record touched recently is deliberately not counted as dormant. ACTIVE staff
    // are never eligible no matter how old the row is.
    return this.prisma.employee.count({
      where: { status: { in: ['RESIGNED', 'INACTIVE'] }, updatedAt: { lt: cutoff } },
    });
  }

  async list(filter: EmployeeListFilter): Promise<{ rows: Employee[]; total: number }> {
    const where: Prisma.EmployeeWhereInput = {
      ...(filter.depotIds ? { depotId: depotWhere(filter.depotIds) } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.search
        ? {
            OR: [
              { fullName: { contains: filter.search, mode: 'insensitive' } },
              { employeeCode: { contains: filter.search, mode: 'insensitive' } },
              { phone: { contains: filter.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string): Promise<Employee | null> {
    return this.prisma.employee.findUnique({ where: { id } });
  }

  findByEmployeeCode(employeeCode: string): Promise<Employee | null> {
    return this.prisma.employee.findUnique({ where: { employeeCode } });
  }

  findByPhone(phone: string): Promise<Employee | null> {
    return this.prisma.employee.findFirst({ where: { phone }, orderBy: { createdAt: 'asc' } });
  }

  findByNik(nik: string): Promise<Employee | null> {
    return this.prisma.employee.findUnique({ where: { nik } });
  }

  async findConflicting(keys: {
    employeeCode?: string;
    nik?: string;
    phone: string;
  }): Promise<'employeeCode' | 'nik' | 'phone' | null> {
    const or: Prisma.EmployeeWhereInput[] = [{ phone: keys.phone }];
    if (keys.employeeCode) or.push({ employeeCode: keys.employeeCode });
    if (keys.nik) or.push({ nik: keys.nik });
    // Only the three columns are selected — the caller wants a verdict, not a person, and
    // an employee row carries salary and NIK it has no business loading for a check.
    const hit = await this.prisma.employee.findFirst({
      where: { OR: or },
      select: { employeeCode: true, nik: true, phone: true },
    });
    if (!hit) return null;
    // Ordered so the message names the most specific collision: a staff code is typed by
    // hand, a NIK is copied off a card, a shared phone is the likeliest innocent one.
    if (keys.employeeCode && hit.employeeCode === keys.employeeCode) return 'employeeCode';
    if (keys.nik && hit.nik === keys.nik) return 'nik';
    return 'phone';
  }

  findByAuthSubjectId(authSubjectId: string): Promise<Employee | null> {
    return this.prisma.employee.findUnique({ where: { authSubjectId } });
  }

  async findByAuthSubjectIdOrPhone(
    authSubjectId: string,
    phone: string,
  ): Promise<{ linked: Employee | null; oldestByPhone: Employee | null }> {
    // `authSubjectId` is unique so it contributes at most one row; a phone is not (a family
    // shares a number), so the read is bounded and ordered — `findByPhone`'s own contract is
    // "the oldest match, the same row every re-upload, rather than a coin flip".
    const rows = await this.prisma.employee.findMany({
      where: { OR: [{ authSubjectId }, { phone }] },
      orderBy: { createdAt: 'asc' },
      take: SHARED_PHONE_CAP,
    });
    return {
      linked: rows.find((r) => r.authSubjectId === authSubjectId) ?? null,
      oldestByPhone: rows.find((r) => r.phone === phone) ?? null,
    };
  }

  listHistory(employeeId: string): Promise<EmploymentHistory[]> {
    return this.prisma.employmentHistory.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(
    data: Prisma.EmployeeCreateInput,
    history?: Prisma.EmploymentHistoryCreateWithoutEmployeeInput,
  ): Promise<Employee> {
    return this.prisma.employee.create({
      data: history ? { ...data, history: { create: history } } : data,
    });
  }

  update(
    id: string,
    data: Prisma.EmployeeUpdateInput,
    history: Prisma.EmploymentHistoryCreateWithoutEmployeeInput[],
  ): Promise<Employee> {
    return this.prisma.employee.update({
      where: { id },
      data: history.length ? { ...data, history: { create: history } } : data,
    });
  }
}
