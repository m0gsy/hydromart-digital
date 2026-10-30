import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import type { DepotOwnerShare } from '../../domain/depot-owners';
import { OwnershipType } from '../../domain/inventory';
import type { ServiceArea } from '../../domain/service-area';
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
  assistantSupervisorId: string | null;
  contactPhone: string | null;
  paymentBankName: string | null;
  paymentBankAccountNumber: string | null;
  paymentBankAccountHolder: string | null;
  paymentQrisImageUrl: string | null;
  operatingHours: unknown;
  holidays: unknown;
  serviceArea?: unknown;
  owners?: { ownerId: string; sharePct: { toNumber(): number }; isPrimary: boolean }[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** The open generation of owners, primary first, so every read carries the current split. */
const WITH_OWNERS = {
  owners: {
    where: { effectiveTo: null },
    orderBy: [{ isPrimary: 'desc' as const }, { ownerId: 'asc' as const }],
  },
};

function ownerRows(owners: readonly DepotOwnerShare[], depotId: string, now: Date, by?: string) {
  return owners.map((o) => ({
    depotId,
    ownerId: o.ownerId,
    sharePct: o.sharePct,
    isPrimary: o.isPrimary,
    effectiveFrom: now,
    createdBy: by ?? null,
  }));
}

@Injectable()
export class DepotPrismaRepository implements DepotRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: DepotRow): DepotRecord {
    const { owners, ...rest } = row;
    return {
      ...rest,
      ...(owners
        ? {
            owners: owners.map((o) => ({
              ownerId: o.ownerId,
              sharePct: o.sharePct.toNumber(),
              isPrimary: o.isPrimary,
            })),
          }
        : {}),
      ownershipType: row.ownershipType as OwnershipType,
      deliveryFee: row.deliveryFee.toNumber(),
      minOrderAmount: row.minOrderAmount ? row.minOrderAmount.toNumber() : null,
      operatingHours: (row.operatingHours ?? {}) as OperatingHours,
      holidays: (row.holidays ?? []) as Holiday[],
      serviceArea: (row.serviceArea ?? null) as ServiceArea | null,
    };
  }

  private whereFor(
    query: Pick<DepotQuery, 'ownershipType' | 'search' | 'activeOnly' | 'depotIds' | 'ownerId'>,
  ) {
    return {
      ...(query.depotIds ? { id: { in: [...query.depotIds] } } : {}),
      ...(query.ownerId ? { owners: { some: { ownerId: query.ownerId, effectiveTo: null } } } : {}),
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
        include: WITH_OWNERS,
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
      include: WITH_OWNERS,
    });
    return row ? this.toRecord(row) : null;
  }

  async findManyByIds(ids: string[], activeOnly: boolean): Promise<DepotRecord[]> {
    // An empty `in` list is a query that can only return nothing; skipping the round trip
    // matters because the caller's list is often empty (a customer holding no deposit).
    if (ids.length === 0) return [];
    const rows = await this.prisma.depot.findMany({
      where: { id: { in: [...new Set(ids)] }, ...(activeOnly ? { active: true } : {}) },
      include: WITH_OWNERS,
    });
    return rows.map((row) => this.toRecord(row));
  }

  /**
   * Existence only, cached once true (audit S-19). Nothing in the product deletes a depot,
   * so "it exists" cannot become false; "it does not exist" can become true the moment
   * somebody creates one, which is why only the positive answer is kept.
   */
  private readonly known = new Set<string>();

  async exists(id: string): Promise<boolean> {
    if (this.known.has(id)) return true;
    const row = await this.prisma.depot.findUnique({ where: { id }, select: { id: true } });
    if (row) this.known.add(id);
    return row !== null;
  }

  async findByCode(code: string): Promise<DepotRecord | null> {
    const row = await this.prisma.depot.findUnique({ where: { code }, include: WITH_OWNERS });
    return row ? this.toRecord(row) : null;
  }

  async findManyByCodes(codes: string[]): Promise<DepotRecord[]> {
    if (codes.length === 0) return [];
    const rows = await this.prisma.depot.findMany({
      where: { code: { in: [...new Set(codes)] } },
      include: WITH_OWNERS,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async findByOwner(ownerId: string): Promise<DepotRecord[]> {
    const rows = await this.prisma.depot.findMany({
      where: { owners: { some: { ownerId, effectiveTo: null } } },
      include: WITH_OWNERS,
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async ownersAsOf(depotId: string, asOf: Date): Promise<DepotOwnerShare[]> {
    const rows = await this.prisma.depotOwner.findMany({
      where: {
        depotId,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
      },
      orderBy: [{ isPrimary: 'desc' }, { ownerId: 'asc' }],
    });
    return rows.map((o) => ({
      ownerId: o.ownerId,
      sharePct: o.sharePct.toNumber(),
      isPrimary: o.isPrimary,
    }));
  }

  async create(data: CreateDepotData): Promise<DepotRecord> {
    const { serviceArea, owners, ...rest } = data;
    const row = await this.prisma.depot.create({
      include: WITH_OWNERS,
      data: {
        ...rest,
        ...(owners && owners.length > 0
          ? {
              owners: {
                create: owners.map((o) => ({
                  ownerId: o.ownerId,
                  sharePct: o.sharePct,
                  isPrimary: o.isPrimary,
                })),
              },
            }
          : {}),
        operatingHours: data.operatingHours as Prisma.InputJsonValue,
        holidays: data.holidays as unknown as Prisma.InputJsonValue,
        ...(serviceArea ? { serviceArea: serviceArea as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    return this.toRecord(row);
  }

  async update(id: string, patch: UpdateDepotData): Promise<DepotRecord> {
    const { operatingHours, holidays, serviceArea, owners, ...rest } = patch;
    const data = {
      ...rest,
      ...(operatingHours !== undefined
        ? { operatingHours: operatingHours as Prisma.InputJsonValue }
        : {}),
      ...(holidays !== undefined ? { holidays: holidays as unknown as Prisma.InputJsonValue } : {}),
      // null clears the drawn area (back to radius routing); undefined leaves it alone.
      ...(serviceArea !== undefined
        ? {
            serviceArea:
              serviceArea === null
                ? Prisma.DbNull
                : (serviceArea as unknown as Prisma.InputJsonValue),
          }
        : {}),
    };
    if (owners === undefined) {
      const row = await this.prisma.depot.update({ where: { id }, data, include: WITH_OWNERS });
      return this.toRecord(row);
    }
    // One transaction: close the open generation, open the new one, and move the mirror. A
    // reader never sees a depot with no owners or with two generations open at once.
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.depotOwner.updateMany({
        where: { depotId: id, effectiveTo: null },
        data: { effectiveTo: now },
      });
      if (owners.length > 0) {
        await tx.depotOwner.createMany({ data: ownerRows(owners, id, now) });
      }
      return tx.depot.update({ where: { id }, data, include: WITH_OWNERS });
    });
    return this.toRecord(row);
  }
}
