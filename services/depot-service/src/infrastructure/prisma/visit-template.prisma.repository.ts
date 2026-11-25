import { Injectable } from '@nestjs/common';

import { VisitTemplate, VisitTemplateItemInput } from '../../domain/visit-template';
import {
  VisitTemplateRepository,
  VisitTemplateWrite,
} from '../../application/ports/visit-template.repository';
import { PrismaService } from './prisma.service';

const WITH_ITEMS = { items: { orderBy: { position: 'asc' as const } } };

@Injectable()
export class VisitTemplatePrismaRepository implements VisitTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  private rows(items: VisitTemplateItemInput[]) {
    return items.map((item, position) => ({
      position,
      text: item.text,
      sopId: item.sopId ?? null,
    }));
  }

  list(activeOnly: boolean): Promise<VisitTemplate[]> {
    return this.prisma.visitTemplate.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: { createdAt: 'desc' },
      include: WITH_ITEMS,
    });
  }

  findById(id: string): Promise<VisitTemplate | null> {
    return this.prisma.visitTemplate.findUnique({ where: { id }, include: WITH_ITEMS });
  }

  create(data: VisitTemplateWrite & { createdBy: string }): Promise<VisitTemplate> {
    return this.prisma.visitTemplate.create({
      data: {
        name: data.name,
        createdBy: data.createdBy,
        items: { create: this.rows(data.items) },
      },
      include: WITH_ITEMS,
    });
  }

  async replace(
    id: string,
    data: VisitTemplateWrite & { active: boolean },
  ): Promise<VisitTemplate | null> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.visitTemplate.findUnique({ where: { id }, select: { id: true } });
      if (!found) return null;
      await tx.visitTemplateItem.deleteMany({ where: { templateId: id } });
      return tx.visitTemplate.update({
        where: { id },
        data: {
          name: data.name,
          active: data.active,
          items: { create: this.rows(data.items) },
        },
        include: WITH_ITEMS,
      });
    });
  }
}
