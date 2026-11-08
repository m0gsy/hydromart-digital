import { Injectable } from '@nestjs/common';

import { DepotDeactivationProbe } from '../../application/ports/depot-deactivation.probe';
import { PrismaService } from './prisma.service';

/**
 * DEP-10. Counts only what this service owns: live stock reservations, purchase orders out
 * with a supplier, and transfers still on the road in either direction. An open cashier shift
 * lives in delivery-service and the gallon deposit balance in the ledger; neither is checked
 * here, which is said in the PR rather than implied.
 */
@Injectable()
export class DepotDeactivationPrismaProbe implements DepotDeactivationProbe {
  constructor(private readonly prisma: PrismaService) {}

  async blockers(depotId: string): Promise<string[]> {
    const [reservations, purchaseOrders, transfers] = await Promise.all([
      this.prisma.stockReservation.count({ where: { status: 'ACTIVE', item: { depotId } } }),
      this.prisma.purchaseOrder.count({ where: { depotId, status: 'SENT' } }),
      this.prisma.stockTransfer.count({
        where: { status: 'SENT', OR: [{ fromDepotId: depotId }, { toDepotId: depotId }] },
      }),
    ]);
    const out: string[] = [];
    if (reservations > 0) out.push(`${reservations} reservasi stok aktif`);
    if (purchaseOrders > 0) out.push(`${purchaseOrders} pesanan pembelian (PO) terkirim`);
    if (transfers > 0) out.push(`${transfers} transfer stok terkirim`);
    return out;
  }
}
