import { Injectable } from '@nestjs/common';

import { Customer } from '../../../domain/customer/customer.entity';
import {
  CreateCustomerData,
  CustomerRepository,
} from '../../../application/ports/customer.repository';
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

  async save(customer: Customer): Promise<Customer> {
    const props = customer.toProps();
    const row = await this.prisma.customer.update({
      where: { id: props.id },
      data: {
        email: props.email,
        fullName: props.fullName,
        status: toPrismaStatus(props.status),
        googleSub: props.googleSub,
        phoneVerifiedAt: props.phoneVerifiedAt,
        lastLoginAt: props.lastLoginAt,
      },
    });
    return toCustomerEntity(row);
  }
}
