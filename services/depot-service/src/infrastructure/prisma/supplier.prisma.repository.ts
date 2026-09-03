import { Injectable } from '@nestjs/common';

import { Supplier } from '../../domain/supplier';
import {
  CreateSupplierData,
  SupplierRepository,
  UpdateSupplierData,
} from '../../application/ports/supplier.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class SupplierPrismaRepository implements SupplierRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateSupplierData): Promise<Supplier> {
    return this.prisma.supplier.create({ data });
  }

  async update(id: string, data: UpdateSupplierData): Promise<Supplier> {
    return this.prisma.supplier.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.supplier.delete({ where: { id } });
  }

  async countPurchaseOrders(supplierId: string): Promise<number> {
    return this.prisma.purchaseOrder.count({ where: { supplierId } });
  }

  async listForDepot(depotId: string): Promise<Supplier[]> {
    return this.prisma.supplier.findMany({ where: { depotId }, orderBy: { createdAt: 'desc' } });
  }

  async findById(id: string): Promise<Supplier | null> {
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  async findByCode(depotId: string, code: string): Promise<Supplier | null> {
    return this.prisma.supplier.findUnique({ where: { depotId_code: { depotId, code } } });
  }
}
