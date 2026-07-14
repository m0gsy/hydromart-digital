import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import { OwnershipType } from '../../domain/inventory';
import {
  CreateDepotData,
  DepotQuery,
  DepotRecord,
  DepotRepository,
  Holiday,
  OperatingHours,
  UpdateDepotData,
} from '../../application/ports/depot.repository';
import { PrismaService } from './prisma.service';

interface DepotRow {
  id: string;
  code: string;
  name: string;
  ownershipType: string;
  address: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  deliveryFee: { toNumber(): number };
  minOrderAmount: { toNumber(): number } | null;
  ownerId: string | null;
  paymentBankName: string | null;
  paymentBankAccountNumber: string | null;
  paymentBankAccountHolder: string | null;
  paymentQrisImageUrl: string | null;
  operatingHours: unknown;
  holidays: unknown;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class DepotPrismaRepository implements DepotRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: DepotRow): DepotRecord {
    return {
      ...row,
      ownershipType: row.ownershipType as OwnershipType,
      deliveryFee: row.deliveryFee.toNumber(),
      minOrderAmount: row.minOrderAmount ? row.minOrderAmount.toNumber() : null,
      operatingHours: (row.operatingHours ?? {}) as OperatingHours,
      holidays: (row.holidays ?? []) as Holiday[],
    };
  }

  private whereFor(query: Pick<DepotQuery, 'ownershipType' | 'search' | 'activeOnly'>) {
    return {
      ...(query.activeOnly ? { active: true } : {}),
      ...(query.ownershipType ? { ownershipType: query.ownershipType } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { code: { contains: query.search, mode: 'insensitive' as const } },
              { city: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }

  async search(query: DepotQuery): Promise<{ items: DepotRecord[]; total: number }> {
    const where = this.whereFor(query);
    const [rows, total] = await Promise.all([
      this.prisma.depot.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.depot.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r)), total };
  }

  async findById(id: string, activeOnly: boolean): Promise<DepotRecord | null> {
    const row = await this.prisma.depot.findFirst({
      where: { id, ...(activeOnly ? { active: true } : {}) },
    });
    return row ? this.toRecord(row) : null;
  }

  async findByCode(code: string): Promise<DepotRecord | null> {
    const row = await this.prisma.depot.findUnique({ where: { code } });
    return row ? this.toRecord(row) : null;
  }

  async findByOwner(ownerId: string): Promise<DepotRecord[]> {
    const rows = await this.prisma.depot.findMany({
      where: { ownerId },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async create(data: CreateDepotData): Promise<DepotRecord> {
    const row = await this.prisma.depot.create({
      data: {
        ...data,
        operatingHours: data.operatingHours as Prisma.InputJsonValue,
        holidays: data.holidays as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toRecord(row);
  }

  async update(id: string, patch: UpdateDepotData): Promise<DepotRecord> {
    const { operatingHours, holidays, ...rest } = patch;
    const row = await this.prisma.depot.update({
      where: { id },
      data: {
        ...rest,
        ...(operatingHours !== undefined
          ? { operatingHours: operatingHours as Prisma.InputJsonValue }
          : {}),
        ...(holidays !== undefined
          ? { holidays: holidays as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return this.toRecord(row);
  }
}
