import { Injectable } from '@nestjs/common';

import { StaleWriteError } from '@hydromart/platform';

import { CreateProductData, PriceChangeRecord, ProductQuery, ProductRecord, ProductRepository, UpdateProductData } from '../../application/ports/product.repository';
import { PrismaService } from './prisma.service';

interface ProductRow {
  id: string;
  categoryId: string | null;
  name: string;
  sku: string;
  description: string | null;
  unit: string;
  volumeMl: number | null;
  isGallon: boolean;
  basePrice: { toNumber(): number };
  imageUrl: string | null;
  images: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProductPrismaRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ProductRow): ProductRecord {
    return { ...row, basePrice: row.basePrice.toNumber() };
  }

  private whereFor(query: Pick<ProductQuery, 'categoryId' | 'search' | 'activeOnly'>) {
    return {
      ...(query.activeOnly ? { active: true } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { sku: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }

  async search(query: ProductQuery): Promise<{ items: ProductRecord[]; total: number }> {
    const where = this.whereFor(query);
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r)), total };
  }

  async findById(id: string, activeOnly: boolean): Promise<ProductRecord | null> {
    const row = await this.prisma.product.findFirst({
      where: { id, ...(activeOnly ? { active: true } : {}) },
    });
    return row ? this.toRecord(row) : null;
  }

  async findActiveByIds(ids: string[]): Promise<ProductRecord[]> {
    const rows = await this.prisma.product.findMany({ where: { id: { in: ids }, active: true } });
    return rows.map((row) => this.toRecord(row));
  }

  async findBySku(sku: string): Promise<ProductRecord | null> {
    const row = await this.prisma.product.findUnique({ where: { sku } });
    return row ? this.toRecord(row) : null;
  }

  async create(data: CreateProductData): Promise<ProductRecord> {
    const row = await this.prisma.product.create({ data });
    return this.toRecord(row);
  }

  async updateWithPriceAudit(
    id: string,
    patch: UpdateProductData,
    audit: { changedBy: string; fromPrice: number; toPrice: number },
    expectedUpdatedAt?: Date,
  ): Promise<ProductRecord> {
    // PRD-1: one transaction. A trail written separately can disagree with the price it is
    // supposed to explain, which is the same gap in a smaller window. The stamp check rides
    // in it too: `fromPrice` was read before this write, and a concurrent edit would make the
    // trail name a price that was never the previous one.
    return this.prisma.$transaction(async (tx) => {
      if (expectedUpdatedAt) {
        const { count } = await tx.product.updateMany({
          where: { id, updatedAt: expectedUpdatedAt },
          data: patch,
        });
        if (count === 0) throw new StaleWriteError();
      } else {
        await tx.product.update({ where: { id }, data: patch });
      }
      await tx.productPriceChange.create({
        data: {
          productId: id,
          changedBy: audit.changedBy,
          fromPrice: audit.fromPrice,
          toPrice: audit.toPrice,
        },
      });
      return this.toRecord(await tx.product.findUniqueOrThrow({ where: { id } }));
    });
  }

  async listPriceChanges(productId: string, limit: number): Promise<PriceChangeRecord[]> {
    const rows = await this.prisma.productPriceChange.findMany({
      where: { productId },
      orderBy: { changedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      changedBy: r.changedBy,
      fromPrice: r.fromPrice.toNumber(),
      toPrice: r.toPrice.toNumber(),
      changedAt: r.changedAt,
    }));
  }

  async update(
    id: string,
    patch: UpdateProductData,
    expectedUpdatedAt?: Date,
  ): Promise<ProductRecord> {
    if (expectedUpdatedAt) {
      const { count } = await this.prisma.product.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data: patch,
      });
      if (count === 0) throw new StaleWriteError();
      return this.toRecord(await this.prisma.product.findUniqueOrThrow({ where: { id } }));
    }
    const row = await this.prisma.product.update({ where: { id }, data: patch });
    return this.toRecord(row);
  }
}
