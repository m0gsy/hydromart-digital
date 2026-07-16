import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { Customer } from '../../../domain/customer/customer.entity';
import { Role } from '../../../domain/customer/role.enum';
import { CustomerStatus } from '../../../domain/customer/customer-status.enum';
import {
  CreateCustomerData,
  CustomerRepository,
} from '../../../application/ports/customer.repository';
import { EmailAlreadyRegisteredError } from '../../../domain/errors/auth.errors';
import { PrismaService } from '../prisma.service';
import { toCustomerEntity, toPrismaRole, toPrismaStatus } from '../mappers';

@Injectable()
export class CustomerPrismaRepository implements CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findUnique({ where: { id } });
    return row ? toCustomerEntity(row) : null;
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
    const row = await this.prisma.customer.create({
      data: {
        phone: data.phone,
        email: data.email,
        fullName: data.fullName,
        role: toPrismaRole(data.role),
      },
    });
    return toCustomerEntity(row);
  }

  async listStaff(
    page: number,
    limit: number,
    role?: Role,
  ): Promise<{ items: Customer[]; total: number }> {
    const where = {
      status: { not: toPrismaStatus(CustomerStatus.DELETED) },
      role: role ? toPrismaRole(role) : { not: toPrismaRole(Role.CUSTOMER) },
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

  async save(customer: Customer): Promise<Customer> {
    const props = customer.toProps();
    try {
      const row = await this.prisma.customer.update({
        where: { id: props.id },
        data: {
          email: props.email,
          fullName: props.fullName,
          role: toPrismaRole(props.role),
          status: toPrismaStatus(props.status),
          googleSub: props.googleSub,
          avatarUrl: props.avatarUrl,
          phoneVerifiedAt: props.phoneVerifiedAt,
          lastLoginAt: props.lastLoginAt,
        },
      });
      return toCustomerEntity(row);
    } catch (err) {
      // Backstop the email-uniqueness race the service pre-check can't close.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        (err.meta?.target as string[] | undefined)?.includes('email')
      ) {
        throw new EmailAlreadyRegisteredError();
      }
      throw err;
    }
  }
}
