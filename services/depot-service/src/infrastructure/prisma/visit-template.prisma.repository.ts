import { Injectable } from '@nestjs/common';
import { StaleWriteError } from '@hydromart/platform';

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
    seenUpdatedAt: string,
  ): Promise<VisitTemplate | null> {
    // Items are deleted and recreated, so their ids change on every replace. A visit (PR-4) must
    // therefore snapshot text and sopId BY VALUE and never reference visit_template_items.id.
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.visitTemplate.findUnique({ where: { id }, select: { id: true } });
      if (!found) return null;
      // The freshness guard is the WHERE of the write itself: two editors holding the same
      // `updatedAt` cannot both match, so the loser sees count 0 and nothing is deleted.
      const claimed = await tx.visitTemplate.updateMany({
        where: { id, updatedAt: new Date(seenUpdatedAt) },
        data: { name: data.name, active: data.active },
      });
      if (claimed.count === 0) throw new StaleWriteError();
      await tx.visitTemplateItem.deleteMany({ where: { templateId: id } });
      await tx.visitTemplateItem.createMany({
        data: this.rows(data.items).map((r) => ({ ...r, templateId: id })),
      });
      return tx.visitTemplate.findUniqueOrThrow({ where: { id }, include: WITH_ITEMS });
    });
  }
}
