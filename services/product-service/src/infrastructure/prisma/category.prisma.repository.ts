import { Injectable } from '@nestjs/common';

import {
  CategoryRecord,
  CategoryRepository,
  CreateCategoryData,
  UpdateCategoryData,
} from '../../application/ports/category.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class CategoryPrismaRepository implements CategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(activeOnly: boolean): Promise<CategoryRecord[]> {
    return this.prisma.category.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findById(id: string): Promise<CategoryRecord | null> {
    return this.prisma.category.findUnique({ where: { id } });
  }

  findBySlug(slug: string): Promise<CategoryRecord | null> {
    return this.prisma.category.findUnique({ where: { slug } });
  }

  create(data: CreateCategoryData): Promise<CategoryRecord> {
    return this.prisma.category.create({ data });
  }

  update(id: string, patch: UpdateCategoryData): Promise<CategoryRecord> {
    return this.prisma.category.update({ where: { id }, data: patch });
  }
}
