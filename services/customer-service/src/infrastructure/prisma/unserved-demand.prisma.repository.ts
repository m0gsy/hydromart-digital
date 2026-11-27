import { Injectable } from '@nestjs/common';

import {
  UnservedDemandRepository,
  UnservedDemandRow,
  UnservedMarker,
  UnservedSummary,
} from '../../application/ports/unserved-demand.repository';
import { PrismaService } from './prisma.service';

class StaleMarker extends Error {}

@Injectable()
export class UnservedDemandPrismaRepository implements UnservedDemandRepository {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(monthKey: string): Promise<UnservedSummary> {
    const where = { monthKey };
    const [kec, kel, grid, bands] = await Promise.all([
      this.prisma.unservedDemand.groupBy({ by: ['kecamatanCode'], where, _count: { _all: true }, orderBy: { kecamatanCode: 'asc' } }),
      this.prisma.unservedDemand.groupBy({ by: ['kelurahanCode'], where, _count: { _all: true }, orderBy: { kelurahanCode: 'asc' } }),
      this.prisma.unservedDemand.groupBy({ by: ['gridCell'], where, _count: { _all: true }, orderBy: { gridCell: 'asc' } }),
      this.prisma.unservedDemand.groupBy({ by: ['distanceBand'], where, _count: { _all: true }, orderBy: { distanceBand: 'asc' } }),
    ]);
    return {
      kecamatan: kec.map((r) => ({ code: r.kecamatanCode, count: r._count._all })),
      kelurahan: kel.map((r) => ({ code: r.kelurahanCode, count: r._count._all })),
      grid: grid.map((r) => ({ cell: r.gridCell, count: r._count._all })),
      bands: bands.map((r) => ({ band: r.distanceBand, count: r._count._all })),
    };
  }

  async record(row: UnservedDemandRow, marker: UnservedMarker): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.unservedDemand.create({ data: row });
        const { count } = await tx.address.updateMany({
          where: {
            id: marker.addressId,
            customerId: marker.customerId,
            latitude: marker.latitude,
            longitude: marker.longitude,
            kecamatanCode: { not: null },
            // `<>` alone would skip a NULL marker.
            OR: [{ unservedMonth: null }, { unservedMonth: { not: row.monthKey } }],
          },
          data: { unservedMonth: row.monthKey },
        });
        // Throwing rolls the row back too: nothing is recorded for a pin that is gone.
        if (count === 0) throw new StaleMarker();
      });
      return true;
    } catch (error) {
      if (error instanceof StaleMarker) return false;
      throw error;
    }
  }
}
