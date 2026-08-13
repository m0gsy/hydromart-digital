import { Injectable } from '@nestjs/common';

import {
  CloseDayData,
  DailyCloseRecord,
  DailyCloseRepository,
} from '../../application/ports/daily-close.repository';
import { PrismaService } from './prisma.service';

/** DB row -> record. `businessDate` goes back out as the 'YYYY-MM-DD' the caller sent. */
function toRecord(row: {
  id: string;
  depotId: string;
  businessDate: Date;
  closedAt: Date;
  closedBy: string;
  cashInIdr: number;
  cashOutIdr: number;
  konterIdr: number;
  codDepositedIdr: number;
  codExpectedIdr: number;
  note: string | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
}): DailyCloseRecord {
  // tz-ok: businessDate is @db.Date — already the depot's local trading day.
  return { ...row, businessDate: row.businessDate.toISOString().slice(0, 10) };
}

@Injectable()
export class DailyClosePrismaRepository implements DailyCloseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(depotId: string, businessDate: string): Promise<DailyCloseRecord | null> {
    const row = await this.prisma.depotDailyClose.findUnique({
      where: { depotId_businessDate: { depotId, businessDate: new Date(businessDate) } },
    });
    return row ? toRecord(row) : null;
  }

  /**
   * Upsert, not insert: closing a day HQ reopened replaces the snapshot and clears the
   * reopen marks. Two rows for one day would be two answers to "what did this depot take".
   */
  async close(data: CloseDayData): Promise<DailyCloseRecord> {
    const businessDate = new Date(data.businessDate);
    const values = {
      closedAt: new Date(),
      closedBy: data.closedBy,
      cashInIdr: data.cashInIdr,
      cashOutIdr: data.cashOutIdr,
      konterIdr: data.konterIdr,
      codDepositedIdr: data.codDepositedIdr,
      codExpectedIdr: data.codExpectedIdr,
      note: data.note,
      reopenedAt: null,
      reopenedBy: null,
    };
    const row = await this.prisma.depotDailyClose.upsert({
      where: { depotId_businessDate: { depotId: data.depotId, businessDate } },
      create: { depotId: data.depotId, businessDate, ...values },
      update: values,
    });
    return toRecord(row);
  }

  async reopen(
    depotId: string,
    businessDate: string,
    reopenedBy: string,
  ): Promise<DailyCloseRecord> {
    const row = await this.prisma.depotDailyClose.update({
      where: { depotId_businessDate: { depotId, businessDate: new Date(businessDate) } },
      data: { reopenedAt: new Date(), reopenedBy },
    });
    return toRecord(row);
  }

  async listForDepotRange(depotId: string, from: Date, to: Date): Promise<DailyCloseRecord[]> {
    const rows = await this.prisma.depotDailyClose.findMany({
      where: { depotId, businessDate: { gte: from, lt: to } },
      orderBy: { businessDate: 'asc' },
    });
    return rows.map(toRecord);
  }
}
