import { Injectable } from '@nestjs/common';

import {
  MeterReadingRepository,
  UpsertMeterReadingData,
} from '../../application/ports/meter-reading.repository';
import { MeterReading } from '../../domain/meter-reading';
import { PrismaService } from './prisma.service';

interface Decimalish {
  toNumber(): number;
}

interface MeterReadingRow {
  depotId: string;
  readingDate: Date;
  openingM3: Decimalish;
  closingM3: Decimalish | null;
  sourceOpeningM3: Decimalish | null;
  sourceClosingM3: Decimalish | null;
  openedBy: string;
  openedAt: Date;
  closedBy: string | null;
  closedAt: Date | null;
  alertedAt: Date | null;
  note: string | null;
}

/** 'YYYY-MM-DD' -> the UTC midnight Postgres stores for a DATE column. */
function toDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toDayString(value: Date): string {
  // tz-ok: the meter reading's `date` is @db.Date — the local day staff read it on.
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class MeterReadingPrismaRepository implements MeterReadingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(row: MeterReadingRow): MeterReading {
    return {
      depotId: row.depotId,
      date: toDayString(row.readingDate),
      openingM3: row.openingM3.toNumber(),
      closingM3: row.closingM3 ? row.closingM3.toNumber() : null,
      sourceOpeningM3: row.sourceOpeningM3 ? row.sourceOpeningM3.toNumber() : null,
      sourceClosingM3: row.sourceClosingM3 ? row.sourceClosingM3.toNumber() : null,
      openedBy: row.openedBy,
      openedAt: row.openedAt,
      closedBy: row.closedBy,
      closedAt: row.closedAt,
      alertedAt: row.alertedAt,
      note: row.note,
    };
  }

  /**
   * `openedBy`/`closedBy` are stamped only on the write that first supplies their
   * side, so a later correction records the same person who actually read the dial.
   * A closing-only write with no existing row returns null: the service turns that
   * into a domain error rather than inventing an opening reading of zero.
   */
  async upsertForDate(data: UpsertMeterReadingData): Promise<MeterReading | null> {
    const readingDate = toDate(data.date);
    const existing = await this.prisma.meterReading.findUnique({
      where: { depotId_readingDate: { depotId: data.depotId, readingDate } },
    });

    if (!existing) {
      if (data.openingM3 === undefined) {
        return null;
      }
      const created = await this.prisma.meterReading.create({
        data: {
          depotId: data.depotId,
          readingDate,
          openingM3: data.openingM3,
          closingM3: data.closingM3 ?? null,
          sourceOpeningM3: data.sourceOpeningM3 ?? null,
          sourceClosingM3: data.sourceClosingM3 ?? null,
          openedBy: data.actorId,
          closedBy: data.closingM3 === undefined ? null : data.actorId,
          closedAt: data.closingM3 === undefined ? null : new Date(),
          note: data.note ?? null,
        },
      });
      return this.toDomain(created);
    }

    const closingFirstTime = data.closingM3 !== undefined && existing.closingM3 === null;
    const updated = await this.prisma.meterReading.update({
      where: { depotId_readingDate: { depotId: data.depotId, readingDate } },
      data: {
        ...(data.openingM3 !== undefined ? { openingM3: data.openingM3 } : {}),
        ...(data.closingM3 !== undefined ? { closingM3: data.closingM3 } : {}),
        ...(data.sourceOpeningM3 !== undefined ? { sourceOpeningM3: data.sourceOpeningM3 } : {}),
        ...(data.sourceClosingM3 !== undefined ? { sourceClosingM3: data.sourceClosingM3 } : {}),
        ...(data.note !== undefined ? { note: data.note } : {}),
        ...(closingFirstTime ? { closedBy: data.actorId, closedAt: new Date() } : {}),
      },
    });
    return this.toDomain(updated);
  }

  async findForDate(depotId: string, date: string): Promise<MeterReading | null> {
    const row = await this.prisma.meterReading.findUnique({
      where: { depotId_readingDate: { depotId, readingDate: toDate(date) } },
    });
    return row ? this.toDomain(row) : null;
  }

  async listForRange(depotId: string, from: string, to: string): Promise<MeterReading[]> {
    const rows = await this.prisma.meterReading.findMany({
      where: { depotId, readingDate: { gte: toDate(from), lte: toDate(to) } },
      orderBy: { readingDate: 'asc' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  async markAlerted(depotId: string, date: string): Promise<void> {
    await this.prisma.meterReading.update({
      where: { depotId_readingDate: { depotId, readingDate: toDate(date) } },
      data: { alertedAt: new Date() },
    });
  }
}
