import { Injectable } from '@nestjs/common';

import {
  CreatePaymentMethodData,
  PaymentMethodRecord,
  PaymentMethodRepository,
  UpdatePaymentMethodData,
} from '../../application/ports/payment-method.repository';
import { DefaultPaymentMethodConflictError } from '../../domain/errors';
import { PrismaService } from './prisma.service';

/** Prisma unique-constraint violation (P2002), detected without importing the client namespace. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

@Injectable()
export class PaymentMethodPrismaRepository implements PaymentMethodRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByCustomer(customerId: string): Promise<PaymentMethodRecord[]> {
    return this.prisma.savedPaymentMethod.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findByIdForCustomer(customerId: string, id: string): Promise<PaymentMethodRecord | null> {
    return this.prisma.savedPaymentMethod.findFirst({ where: { id, customerId } });
  }

  create(data: CreatePaymentMethodData): Promise<PaymentMethodRecord> {
    return this.prisma.savedPaymentMethod.create({ data });
  }

  async createExclusiveDefault(data: CreatePaymentMethodData): Promise<PaymentMethodRecord> {
    // Audit DB-2 (create path): clear the existing default and insert the new one in
    // one transaction, mirroring setDefaultExclusive. The loser of two concurrent
    // "add as default" hits the partial unique index
    // (saved_payment_methods_one_default_per_customer) as P2002 — translate to 409.
    try {
      const [, row] = await this.prisma.$transaction([
        this.prisma.savedPaymentMethod.updateMany({
          where: { customerId: data.customerId, isDefault: true },
          data: { isDefault: false },
        }),
        this.prisma.savedPaymentMethod.create({ data }),
      ]);
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DefaultPaymentMethodConflictError();
      }
      throw error;
    }
  }

  update(
    _customerId: string,
    id: string,
    patch: UpdatePaymentMethodData,
  ): Promise<PaymentMethodRecord> {
    return this.prisma.savedPaymentMethod.update({ where: { id }, data: patch });
  }

  async unsetDefault(customerId: string): Promise<void> {
    await this.prisma.savedPaymentMethod.updateMany({
      where: { customerId, isDefault: true },
      data: { isDefault: false },
    });
  }

  async markDefault(customerId: string, id: string): Promise<void> {
    await this.prisma.savedPaymentMethod.updateMany({
      where: { id, customerId },
      data: { isDefault: true },
    });
  }

  async setDefaultExclusive(customerId: string, id: string): Promise<void> {
    // Audit (DB-2 pattern): clear-all then set-one in one transaction so the invariant
    // "exactly one default" holds even under a crash/concurrent setDefault.
    await this.prisma.$transaction([
      this.prisma.savedPaymentMethod.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.savedPaymentMethod.updateMany({
        where: { id, customerId },
        data: { isDefault: true },
      }),
    ]);
  }

  async delete(customerId: string, id: string): Promise<void> {
    await this.prisma.savedPaymentMethod.deleteMany({ where: { id, customerId } });
  }

  findMostRecent(customerId: string, exceptId?: string): Promise<PaymentMethodRecord | null> {
    return this.prisma.savedPaymentMethod.findFirst({
      where: { customerId, ...(exceptId ? { id: { not: exceptId } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
