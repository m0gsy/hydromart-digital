import { Injectable } from '@nestjs/common';

import { depotWhere } from '@hydromart/platform';

import { AssetMovement, AssetStatus, EmployeeAsset } from '../../../prisma/generated/client';

import {
  AssetListFilter,
  AssetMovementWrite,
  AssetRepository,
  AssetWrite,
} from '../../application/ports/asset.repository';
import { PrismaService } from './prisma.service';


@Injectable()
export class AssetPrismaRepository implements AssetRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: AssetWrite): Promise<EmployeeAsset> {
    return this.prisma.employeeAsset.create({ data });
  }

  update(id: string, data: Partial<AssetWrite>): Promise<EmployeeAsset> {
    return this.prisma.employeeAsset.update({ where: { id }, data });
  }

  findById(id: string): Promise<EmployeeAsset | null> {
    return this.prisma.employeeAsset.findUnique({ where: { id } });
  }

  async list(filter: AssetListFilter): Promise<{ rows: EmployeeAsset[]; total: number }> {
    const where = {
      ...(filter.depotIds ? { depotId: depotWhere(filter.depotIds) } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.holderId ? { holderId: filter.holderId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employeeAsset.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.employeeAsset.count({ where }),
    ]);
    return { rows, total };
  }

  async move(
    movement: AssetMovementWrite,
    next: { status: AssetStatus; holderId: string | null },
  ): Promise<EmployeeAsset> {
    const [, asset] = await this.prisma.$transaction([
      this.prisma.assetMovement.create({ data: movement }),
      this.prisma.employeeAsset.update({
        where: { id: movement.assetId },
        data: { status: next.status, holderId: next.holderId },
      }),
    ]);
    return asset;
  }

  listMovements(assetId: string): Promise<AssetMovement[]> {
    return this.prisma.assetMovement.findMany({ where: { assetId }, orderBy: { movedAt: 'desc' } });
  }
}
