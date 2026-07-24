import { Injectable } from '@nestjs/common';

import { AuditLog, Prisma } from '../../../prisma/generated/client';
import { AuditListFilter, AuditRepository, AuditWrite } from '../../application/ports/audit.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditPrismaRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async write(entry: AuditWrite): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before ?? Prisma.JsonNull,
        after: entry.after ?? Prisma.JsonNull,
        ip: entry.ip,
      },
    });
  }

  async list(filter: AuditListFilter): Promise<{ rows: AuditLog[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      entity: filter.entity,
      entityId: filter.entityId,
      actorId: filter.actorId,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: filter.skip, take: filter.take }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { rows, total };
  }
}
