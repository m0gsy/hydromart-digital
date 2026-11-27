import { Injectable } from '@nestjs/common';

import {
  UnservedDemandRepository,
  UnservedDemandRow,
  UnservedMarker,
} from '../../application/ports/unserved-demand.repository';
import { PrismaService } from './prisma.service';

class StaleMarker extends Error {}

@Injectable()
export class UnservedDemandPrismaRepository implements UnservedDemandRepository {
  constructor(private readonly prisma: PrismaService) {}

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
