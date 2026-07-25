import { Injectable } from '@nestjs/common';

import {
  AddressRecord,
  AddressRepository,
  CreateAddressData,
  UpdateAddressData,
} from '../../application/ports/address.repository';
import { PrimaryAddressConflictError } from '../../domain/errors';
import { PrismaService } from './prisma.service';

/** Prisma unique-constraint violation (P2002), detected without importing the client namespace. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

@Injectable()
export class AddressPrismaRepository implements AddressRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByCustomer(customerId: string): Promise<AddressRecord[]> {
    return this.prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findByIdForCustomer(customerId: string, id: string): Promise<AddressRecord | null> {
    return this.prisma.address.findFirst({ where: { id, customerId } });
  }

  countByCustomer(customerId: string): Promise<number> {
    return this.prisma.address.count({ where: { customerId } });
  }

  create(data: CreateAddressData): Promise<AddressRecord> {
    return this.prisma.address.create({ data });
  }

  async createExclusivePrimary(data: CreateAddressData): Promise<AddressRecord> {
    // Audit DB-2 (create path): clear the existing primary and insert the new one
    // in a single transaction, mirroring setPrimaryExclusive. The loser of two
    // concurrent "add as primary" hits the partial unique index
    // (addresses_one_primary_per_customer) as P2002 — translate to a 409 conflict.
    try {
      const [, row] = await this.prisma.$transaction([
        this.prisma.address.updateMany({
          where: { customerId: data.customerId, isPrimary: true },
          data: { isPrimary: false },
        }),
        this.prisma.address.create({ data }),
      ]);
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PrimaryAddressConflictError();
      }
      throw error;
    }
  }

  update(_customerId: string, id: string, patch: UpdateAddressData): Promise<AddressRecord> {
    return this.prisma.address.update({ where: { id }, data: patch });
  }

  async unsetPrimary(customerId: string): Promise<void> {
    await this.prisma.address.updateMany({
      where: { customerId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  async markPrimary(customerId: string, id: string): Promise<void> {
    await this.prisma.address.updateMany({ where: { id, customerId }, data: { isPrimary: true } });
  }

  async setPrimaryExclusive(customerId: string, id: string): Promise<void> {
    // Audit DB-2: clear-all then set-one in one transaction so the invariant
    // "exactly one primary" holds even under a crash/concurrent setPrimary.
    await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { customerId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.address.updateMany({ where: { id, customerId }, data: { isPrimary: true } }),
    ]);
  }

  async delete(customerId: string, id: string): Promise<void> {
    await this.prisma.address.deleteMany({ where: { id, customerId } });
  }

  findMostRecent(customerId: string, exceptId?: string): Promise<AddressRecord | null> {
    return this.prisma.address.findFirst({
      where: { customerId, ...(exceptId ? { id: { not: exceptId } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
