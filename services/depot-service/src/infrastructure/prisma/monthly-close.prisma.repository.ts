import { Injectable } from '@nestjs/common';

import {
  CloseMonthData,
  MonthlyCloseRecord,
  MonthlyCloseRepository,
} from '../../application/ports/monthly-close.repository';
import { PrismaService } from './prisma.service';

/** DB row -> record. `businessMonth` goes back out as the 'YYYY-MM' the caller sent. */
function toRecord(row: {
  id: string;
  depotId: string;
  businessMonth: Date;
  closedAt: Date;
  closedBy: string;
  cashInIdr: number;
  cashOutIdr: number;
  konterIdr: number;
  codDepositedIdr: number;
  codExpectedIdr: number;
  daysClosed: number;
  note: string | null;
  reopenedAt: Date | null;
  reopenedBy: string | null;
}): MonthlyCloseRecord {
  // tz-ok: businessMonth is @db.Date — already the depot's local trading month's 1st.
  return { ...row, businessMonth: row.businessMonth.toISOString().slice(0, 7) };
}

@Injectable()
export class MonthlyClosePrismaRepository implements MonthlyCloseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(depotId: string, businessMonth: string): Promise<MonthlyCloseRecord | null> {
    const row = await this.prisma.depotMonthlyClose.findUnique({
      where: { depotId_businessMonth: { depotId, businessMonth: new Date(`${businessMonth}-01`) } },
    });
    return row ? toRecord(row) : null;
  }

  /**
   * Upsert, not insert: sealing a month HQ reopened replaces the snapshot and clears the
   * reopen marks. Two rows for one month would be two answers to "what did this depot take".
   */
  async close(data: CloseMonthData): Promise<MonthlyCloseRecord> {
    const businessMonth = new Date(`${data.businessMonth}-01`);
    const values = {
      closedAt: new Date(),
      closedBy: data.closedBy,
      cashInIdr: data.cashInIdr,
      cashOutIdr: data.cashOutIdr,
      konterIdr: data.konterIdr,
      codDepositedIdr: data.codDepositedIdr,
      codExpectedIdr: data.codExpectedIdr,
      daysClosed: data.daysClosed,
      note: data.note,
      reopenedAt: null,
      reopenedBy: null,
    };
    const row = await this.prisma.depotMonthlyClose.upsert({
      where: { depotId_businessMonth: { depotId: data.depotId, businessMonth } },
      create: { depotId: data.depotId, businessMonth, ...values },
      update: values,
    });
    return toRecord(row);
  }

  async reopen(
    depotId: string,
    businessMonth: string,
    reopenedBy: string,
  ): Promise<MonthlyCloseRecord> {
    const row = await this.prisma.depotMonthlyClose.update({
      where: { depotId_businessMonth: { depotId, businessMonth: new Date(`${businessMonth}-01`) } },
      data: { reopenedAt: new Date(), reopenedBy },
    });
    return toRecord(row);
  }

  async findSealing(depotId: string, businessDate: string): Promise<MonthlyCloseRecord | null> {
    const businessMonth = new Date(`${businessDate.slice(0, 7)}-01`);
    const row = await this.prisma.depotMonthlyClose.findFirst({
      where: { depotId, businessMonth, reopenedAt: null },
    });
    return row ? toRecord(row) : null;
  }
}
