import { Injectable } from '@nestjs/common';

import { IncidentCategory, IncidentSeverity } from '../../domain/incident';
import {
  CreateIncidentData,
  IncidentRecord,
  IncidentRepository,
} from '../../application/ports/incident.repository';
import { PrismaService } from './prisma.service';

interface IncidentRow {
  id: string;
  driverId: string;
  deliveryId: string | null;
  depotId: string | null;
  category: string;
  severity: string;
  description: string;
  photoUrl: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: Date;
}

@Injectable()
export class IncidentPrismaRepository implements IncidentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: IncidentRow): IncidentRecord {
    return {
      ...row,
      category: row.category as IncidentCategory,
      severity: row.severity as IncidentSeverity,
    };
  }

  async create(data: CreateIncidentData): Promise<IncidentRecord> {
    const row = await this.prisma.fieldIncident.create({ data });
    return this.toRecord(row);
  }

  async listForDepot(
    depotIds: readonly string[] | undefined,
    limit: number,
  ): Promise<IncidentRecord[]> {
    const rows = await this.prisma.fieldIncident.findMany({
      // A null depot is a row written before CA-4-46 taught the route to read the courier's
      // own token. It belongs to no depot queue, and guessing which one would be worse than
      // leaving it to the network-wide read.
      where: depotIds ? { depotId: { in: [...depotIds] } } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async listByDriver(driverId: string, limit: number): Promise<IncidentRecord[]> {
    const rows = await this.prisma.fieldIncident.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toRecord(r));
  }
}
