import { Injectable } from '@nestjs/common';

import {
  CreateProductData,
  ProductQuery,
  ProductRecord,
  ProductRepository,
  UpdateProductData,
} from '../../application/ports/product.repository';
import { PrismaService } from './prisma.service';

interface ProductRow {
  id: string;
  categoryId: string | null;
  name: string;
  sku: string;
  description: string | null;
  unit: string;
  basePrice: { toNumber(): number };
  imageUrl: string | null;
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

  async findBySku(sku: string): Promise<ProductRecord | null> {
    const row = await this.prisma.product.findUnique({ where: { sku } });
    return row ? this.toRecord(row) : null;
  }

  async create(data: CreateProductData): Promise<ProductRecord> {
    const row = await this.prisma.product.create({ data });
    return this.toRecord(row);
  }

  async update(id: string, patch: UpdateProductData): Promise<ProductRecord> {
    const row = await this.prisma.product.update({ where: { id }, data: patch });
    return this.toRecord(row);
  }
}
