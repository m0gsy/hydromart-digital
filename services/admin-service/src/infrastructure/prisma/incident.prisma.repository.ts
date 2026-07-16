import { Injectable } from '@nestjs/common';

import { IncidentSeverity, IncidentStatus } from '../../domain/incident';
import {
  CreateIncidentData,
  IncidentRecord,
  IncidentRepository,
  IncidentUpdateRecord,
  ListIncidentsFilter,
  PatchIncidentData,
} from '../../application/ports/incident.repository';
import { PrismaService } from './prisma.service';

interface IncidentUpdateRow {
  id: string;
  incidentId: string;
  note: string;
  createdAt: Date;
}

interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  affectedService: string;
  status: string;
  startedAt: Date;
  resolvedAt: Date | null;
  note: string | null;
  updates: IncidentUpdateRow[];
}

@Injectable()
export class IncidentPrismaRepository implements IncidentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: IncidentRow): IncidentRecord {
    return {
      ...row,
      severity: row.severity as IncidentSeverity,
      status: row.status as IncidentStatus,
      updates: row.updates as IncidentUpdateRecord[],
    };
  }

  async list(filter: ListIncidentsFilter): Promise<IncidentRecord[]> {
    const where = filter.status ? { status: filter.status } : {};
    const rows = await this.prisma.incident.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      include: { updates: { orderBy: { createdAt: 'desc' } } },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async create(data: CreateIncidentData): Promise<IncidentRecord> {
    const row = await this.prisma.incident.create({
      data: { title: data.title, severity: data.severity, affectedService: data.affectedService, note: data.note ?? null },
      include: { updates: { orderBy: { createdAt: 'desc' } } },
    });
    return this.toRecord(row);
  }

  async patch(id: string, data: PatchIncidentData): Promise<IncidentRecord | null> {
    const existing = await this.prisma.incident.findUnique({ where: { id } });
    if (!existing) return null;
    if (data.note) {
      await this.prisma.incidentUpdate.create({ data: { incidentId: id, note: data.note } });
    }
    if (data.status) {
      await this.prisma.incident.update({
        where: { id },
        data: {
          status: data.status,
          resolvedAt: data.status === IncidentStatus.RESOLVED ? new Date() : null,
        },
      });
    }
    const row = await this.prisma.incident.findUnique({
      where: { id },
      include: { updates: { orderBy: { createdAt: 'desc' } } },
    });
    return row ? this.toRecord(row) : null;
  }
}
