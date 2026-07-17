import { Injectable } from '@nestjs/common';

import {
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from '../../domain/incident';
import {
  CreateIncidentData,
  IncidentRepository,
  UpdateIncidentData,
} from '../../application/ports/incident.repository';
import { PrismaService } from './prisma.service';

interface IncidentRow {
  id: string;
  depotId: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  reportedBy: string;
  courierName: string | null;
  orderRef: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class IncidentPrismaRepository implements IncidentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: IncidentRow): Incident {
    return {
      ...row,
      type: row.type as IncidentType,
      severity: row.severity as IncidentSeverity,
      status: row.status as IncidentStatus,
    };
  }

  async create(data: CreateIncidentData): Promise<Incident> {
    const row = await this.prisma.incident.create({ data });
    return this.toRecord(row);
  }

  async listForDepot(depotId: string, status?: IncidentStatus): Promise<Incident[]> {
    const rows = await this.prisma.incident.findMany({
      where: { depotId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findById(id: string): Promise<Incident | null> {
    const row = await this.prisma.incident.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async update(id: string, data: UpdateIncidentData): Promise<Incident> {
    const row = await this.prisma.incident.update({ where: { id }, data });
    return this.toRecord(row);
  }
}
