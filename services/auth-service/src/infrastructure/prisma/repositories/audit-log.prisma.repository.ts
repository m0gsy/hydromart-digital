import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  AuditLogEntry,
  AuditLogListItem,
  AuditLogQuery,
  AuditLogRepository,
} from '../../../application/ports/audit-log.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AuditLogPrismaRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        customerId: entry.customerId,
        action: entry.action,
        success: entry.success,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async list(query: AuditLogQuery): Promise<{ items: AuditLogListItem[]; total: number }> {
    const where = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Resolve actor identity in one extra query. The staff set is small, so an
    // IN-lookup is cheaper than denormalizing actor columns onto every audit row.
    // ponytail: if the actor set ever grows huge, snapshot actorEmail/role on write.
    const actorIds = [...new Set(rows.map((r) => r.customerId).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, fullName: true, role: true },
        })
      : [];
    const byId = new Map(actors.map((a) => [a.id, a]));

    const items = rows.map((row): AuditLogListItem => {
      const actor = row.customerId ? byId.get(row.customerId) : undefined;
      return {
        id: row.id,
        customerId: row.customerId,
        action: row.action,
        success: row.success,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        metadata: (row.metadata ?? null) as Record<string, unknown> | null,
        createdAt: row.createdAt,
        actorEmail: actor?.email ?? null,
        actorName: actor?.fullName ?? null,
        actorRole: actor?.role ?? null,
      };
    });
    return { items, total };
  }
}
