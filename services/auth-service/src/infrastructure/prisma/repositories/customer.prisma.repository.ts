import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { Customer } from '../../../domain/customer/customer.entity';
import { Role } from '../../../domain/customer/role.enum';
import { CustomerStatus } from '../../../domain/customer/customer-status.enum';
import {
  CreateCustomerData,
  CustomerRepository,
} from '../../../application/ports/customer.repository';
import {
  EmailAlreadyRegisteredError,
  PhoneAlreadyRegisteredError,
} from '../../../domain/errors/auth.errors';
import { PrismaService } from '../prisma.service';
import { toCustomerEntity, toPrismaRole, toPrismaStatus } from '../mappers';

/**
 * A unique-constraint violation, said in the language the service already speaks.
 *
 * Backstops the uniqueness races the service pre-checks can't close: a pre-check reads the
 * number as free, another request writes it, and the index — not the check — decides. Every
 * write of a customer routes through here so neither of them can drift into telling the
 * caller something different from the other.
 *
 * Anything else is rethrown untouched: a P2002 on a column this has no sentence for is not
 * a conflict anyone can act on, and dressing it up as one would hide a real fault.
 */
function translateUniqueViolation(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = err.meta?.target as string[] | undefined;
    if (target?.includes('email')) return new EmailAlreadyRegisteredError();
    if (target?.includes('phone')) return new PhoneAlreadyRegisteredError();
  }
  return err;
}

@Injectable()
export class CustomerPrismaRepository implements CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findUnique({ where: { id } });
    return row ? toCustomerEntity(row) : null;
  }

  async findByIds(ids: string[]): Promise<Customer[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.customer.findMany({ where: { id: { in: ids } } });
    return rows.map(toCustomerEntity);
  }

  async findByPhone(phone: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findUnique({ where: { phone } });
    return row ? toCustomerEntity(row) : null;
  }

  async findByEmail(email: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findUnique({ where: { email } });
    return row ? toCustomerEntity(row) : null;
  }

  async findByGoogleSub(googleSub: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findUnique({ where: { googleSub } });
    return row ? toCustomerEntity(row) : null;
  }

  async create(data: CreateCustomerData): Promise<Customer> {
    try {
      const row = await this.prisma.customer.create({
        data: {
          phone: data.phone,
          email: data.email,
          fullName: data.fullName,
          role: toPrismaRole(data.role),
          assignedDepotId: data.assignedDepotId ?? null,
          vehicleType: data.vehicleType ?? null,
          plateNumber: data.plateNumber ?? null,
        },
      });
      return toCustomerEntity(row);
    } catch (err) {
      // The same backstop `save()` has, for the same reason, on the path that carries the
      // signups: three callers pre-check the number and none of them can win the race —
      // registration, the staff invite (a spreadsheet import replays it row by row), and
      // the counter sale. All three read "free", all three write, and the index decides.
      // Without this the loser gets a raw P2002 out of an unhandled Prisma error, which
      // the filter can only turn into a 500: a person is told the server is broken on the
      // first screen of the product, when what happened is that their number is taken.
      throw translateUniqueViolation(err);
    }
  }

  async listStaff(
    page: number,
    limit: number,
    role?: Role,
    depotId?: string,
    search?: string,
  ): Promise<{ items: Customer[]; total: number }> {
    const term = search?.trim();
    const where = {
      status: { not: toPrismaStatus(CustomerStatus.DELETED) },
      role: role ? toPrismaRole(role) : { not: toPrismaRole(Role.CUSTOMER) },
      ...(depotId ? { assignedDepotId: depotId } : {}),
      // Audit F-12: matching happens here, over the whole directory, instead of in the
      // browser over whatever the first page happened to contain.
      ...(term
        ? {
            OR: [
              { fullName: { contains: term, mode: 'insensitive' as const } },
              { phone: { contains: term } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items: rows.map(toCustomerEntity), total };
  }

  async countCustomersCreated(from?: Date, to?: Date): Promise<number> {
    const createdAt =
      from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } : undefined;
    return this.prisma.customer.count({
      where: {
        status: { not: toPrismaStatus(CustomerStatus.DELETED) },
        role: toPrismaRole(Role.CUSTOMER),
        ...(createdAt ? { createdAt } : {}),
      },
    });
  }

  async markDeletedGuardingLastSuperAdmin(
    customerId: string,
  ): Promise<'deleted' | 'last-super-admin' | 'not-found'> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.customer.findUnique({
        where: { id: customerId },
        select: { role: true },
      });
      if (!target) return 'not-found';
      if (target.role === toPrismaRole(Role.SUPER_ADMIN)) {
        // Locks EVERY active super admin, not just the others: with `id <> target` in the
        // lock, two concurrent deletes of two different super admins each lock only the
        // other one, both see a survivor, and both go through. `ORDER BY id` keeps the two
        // transactions taking the rows in the same order, so they queue instead of
        // deadlocking, and the loser re-reads a table where the winner is already DELETED.
        const live = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM customers
          WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE'
          ORDER BY id
          FOR UPDATE`;
        if (!live.some((row) => row.id !== customerId)) return 'last-super-admin';
      }
      await tx.customer.update({
        where: { id: customerId },
        data: { status: toPrismaStatus(CustomerStatus.DELETED) },
      });
      return 'deleted';
    });
  }

  async save(customer: Customer): Promise<Customer> {
    const props = customer.toProps();
    try {
      const row = await this.prisma.customer.update({
        where: { id: props.id },
        data: {
          // Written since HR became the owner of an employee's contact details: without it
          // `changePhone` was a no-op that reported success.
          phone: props.phone,
          email: props.email,
          fullName: props.fullName,
          role: toPrismaRole(props.role),
          status: toPrismaStatus(props.status),
          googleSub: props.googleSub,
          avatarUrl: props.avatarUrl,
          assignedDepotId: props.assignedDepotId,
          vehicleType: props.vehicleType,
          plateNumber: props.plateNumber,
          phoneVerifiedAt: props.phoneVerifiedAt,
          lastLoginAt: props.lastLoginAt,
        },
      });
      return toCustomerEntity(row);
    } catch (err) {
      throw translateUniqueViolation(err);
    }
  }
}
