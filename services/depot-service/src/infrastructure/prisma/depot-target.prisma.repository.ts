import { Injectable } from '@nestjs/common';

import { DepotTarget } from '../../domain/depot-target';
import {
  DepotTargetRepository,
  UpsertDepotTargetData,
} from '../../application/ports/depot-target.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class DepotTargetPrismaRepository implements DepotTargetRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByDepotMonth(depotId: string, month: string): Promise<DepotTarget | null> {
    return this.prisma.depotTarget.findUnique({ where: { depotId_month: { depotId, month } } });
  }

  upsert(data: UpsertDepotTargetData): Promise<DepotTarget> {
    const { depotId, month, ...values } = data;
    return this.prisma.depotTarget.upsert({
      where: { depotId_month: { depotId, month } },
      create: data,
      update: values,
    });
  }
}
