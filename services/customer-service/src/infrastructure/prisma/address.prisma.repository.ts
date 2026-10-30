import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';

import {
  AddressRecord,
  AddressRepository,
  CreateAddressData,
  UpdateAddressData,
} from '../../application/ports/address.repository';
import {
  AddressLimitError,
  AddressNotFoundError,
  PrimaryAddressConflictError,
} from '../../domain/errors';
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

  /** Serialises every write that changes how many addresses a customer has or which is primary. */
  private async locked<T>(
    customerId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`addr:${customerId}`}, 0))`;
      return work(tx);
    });
  }

  async createWithinLimit(
    data: Omit<CreateAddressData, 'isPrimary'>,
    wantPrimary: boolean,
    max: number,
  ): Promise<AddressRecord> {
    try {
      return await this.locked(data.customerId, async (tx) => {
        const count = await tx.address.count({ where: { customerId: data.customerId } });
        if (count >= max) throw new AddressLimitError(max);
        const isPrimary = wantPrimary || count === 0;
        if (isPrimary) {
          await tx.address.updateMany({
            where: { customerId: data.customerId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        return tx.address.create({ data: { ...data, isPrimary } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new PrimaryAddressConflictError();
      throw error;
    }
  }

  async removeAndPromote(customerId: string, id: string): Promise<boolean> {
    return this.locked(customerId, async (tx) => {
      const target = await tx.address.findFirst({ where: { id, customerId } });
      if (!target) return false;
      await tx.address.deleteMany({ where: { id, customerId } });
      if (target.isPrimary) {
        const next = await tx.address.findFirst({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
        });
        if (next) await tx.address.updateMany({ where: { id: next.id }, data: { isPrimary: true } });
      }
      return true;
    });
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

  /*
   * CUS-2 — the owner is part of the query, not part of the caller's good manners.
   *
   * This took a `customerId` and threw it away (`_customerId`), so the row was found by id
   * alone and ownership rested entirely on every caller remembering to check first. One
   * handler that forgets — or one new one written from the shape of this signature — edits
   * somebody else's address. `updateMany` with both keys makes the database refuse it, and
   * a count of zero is the same answer as "no such row", which is what the caller of a
   * by-id update already knows how to handle.
   */
  async update(
    customerId: string,
    id: string,
    patch: UpdateAddressData,
  ): Promise<AddressRecord> {
    const { count } = await this.prisma.address.updateMany({
      where: { id, customerId },
      data: patch,
    });
    if (count === 0) throw new AddressNotFoundError();
    return this.prisma.address.findUniqueOrThrow({ where: { id } });
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
    try {
      await this.locked(customerId, async (tx) => {
        await tx.address.updateMany({
          where: { customerId, isPrimary: true },
          data: { isPrimary: false },
        });
        const { count } = await tx.address.updateMany({
          where: { id, customerId },
          data: { isPrimary: true },
        });
        // The target was deleted since it was read: roll back rather than leave no primary.
        if (count === 0) throw new AddressNotFoundError();
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new PrimaryAddressConflictError();
      throw error;
    }
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
