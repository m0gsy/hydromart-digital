import { Injectable } from '@nestjs/common';

import { WholesaleTier } from '../../domain/wholesale-tier';
import {
  CreateWholesaleTierData,
  UpdateWholesaleTierData,
  WholesaleTierRepository,
} from '../../application/ports/wholesale-tier.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class WholesaleTierPrismaRepository implements WholesaleTierRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateWholesaleTierData): Promise<WholesaleTier> {
    return this.prisma.wholesaleTier.create({ data });
  }

  async listForDepot(depotId: string): Promise<WholesaleTier[]> {
    return this.prisma.wholesaleTier.findMany({
      where: { depotId },
      orderBy: { minQty: 'asc' },
    });
  }

  async findById(id: string): Promise<WholesaleTier | null> {
    return this.prisma.wholesaleTier.findUnique({ where: { id } });
  }

  async update(id: string, data: UpdateWholesaleTierData): Promise<WholesaleTier> {
    return this.prisma.wholesaleTier.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.wholesaleTier.delete({ where: { id } });
  }
}
