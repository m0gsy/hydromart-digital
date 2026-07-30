import { Injectable } from '@nestjs/common';

import {
  CreateResellerData,
  Reseller,
  ResellerRepository,
  UpdateResellerData,
} from '../../application/ports/reseller.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class ResellerPrismaRepository implements ResellerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(filter: { homeDepotIds?: readonly string[]; active?: boolean }): Promise<Reseller[]> {
    return this.prisma.resellerProfile.findMany({
      where: {
        ...(filter.homeDepotIds ? { homeDepotId: { in: [...filter.homeDepotIds] } } : {}),
        ...(filter.active != null ? { active: filter.active } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(customerId: string): Promise<Reseller | null> {
    return this.prisma.resellerProfile.findUnique({ where: { customerId } });
  }

  create(data: CreateResellerData): Promise<Reseller> {
    return this.prisma.resellerProfile.create({
      data: {
        customerId: data.customerId,
        homeDepotId: data.homeDepotId,
        monthlyTargetQty: data.monthlyTargetQty,
        discountPct: data.discountPct ?? 0,
        joinDate: data.joinDate,
        note: data.note ?? null,
      },
    });
  }

  update(customerId: string, patch: UpdateResellerData): Promise<Reseller> {
    return this.prisma.resellerProfile.update({ where: { customerId }, data: patch });
  }
}
