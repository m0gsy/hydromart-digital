import { Injectable } from '@nestjs/common';

import {
  WaCapRecord,
  WaCapRepository,
  WaCounterRecord,
  WaReserveResult,
  WaTemplateRecord,
  WaTemplateRepository,
} from '../../application/ports/wa.repository';
import { WaCapLimits, WaCategory, rateFor, warnThreshold } from '../../domain/wa-cost';
import { PrismaService } from './prisma.service';

interface DecimalLike {
  toString(): string;
}

const num = (value: DecimalLike | null): number | null => (value === null ? null : Number(value.toString()));
const money = (value: number): number => Math.round(value * 100) / 100;

interface CapRow {
  waNumber: string;
  category: string;
  monthlyMessages: number;
  rateIdr: DecimalLike | null;
  monthlyCostIdr: DecimalLike | null;
  paused: boolean;
}

const toCap = (row: CapRow): WaCapRecord => ({
  waNumber: row.waNumber,
  category: row.category,
  monthlyMessages: row.monthlyMessages,
  rateIdr: num(row.rateIdr),
  monthlyCostIdr: num(row.monthlyCostIdr),
  paused: row.paused,
});

/**
 * HD-12: the monthly caps HQ enters and the WIB-month counters. A reservation is ONE conditional UPDATE
 * (`messages < cap`), so twenty parallel sends against a cap of five reserve exactly five. The counter row is
 * created first with ON CONFLICT DO NOTHING; the UPDATE is what decides.
 */
@Injectable()
export class WaCapPrismaRepository implements WaCapRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getCap(waNumber: string, category: string): Promise<WaCapRecord | null> {
    const row = await this.prisma.waCap.findUnique({
      where: { waNumber_category: { waNumber, category } },
    });
    return row ? toCap(row) : null;
  }

  async listCaps(waNumber: string): Promise<WaCapRecord[]> {
    const rows = await this.prisma.waCap.findMany({ where: { waNumber }, take: 20 });
    return rows.map(toCap);
  }

  async upsertCap(
    waNumber: string,
    category: string,
    limits: Omit<WaCapLimits, 'paused'>,
    by: string,
  ): Promise<void> {
    await this.prisma.waCap.upsert({
      where: { waNumber_category: { waNumber, category } },
      create: { waNumber, category, ...limits, updatedBy: by },
      update: { ...limits, updatedBy: by },
    });
  }

  async setPausedAll(waNumber: string, paused: boolean, by: string): Promise<number> {
    const { count } = await this.prisma.waCap.updateMany({
      where: { waNumber },
      data: { paused, updatedBy: by },
    });
    return count;
  }

  async reserve(waNumber: string, monthKey: string, category: WaCategory): Promise<WaReserveResult> {
    const cap = await this.getCap(waNumber, category);
    if (!cap) return { ok: false, reason: 'CAP' };
    if (cap.paused) return { ok: false, reason: 'PAUSED' };
    const rate = rateFor(category, cap);
    // The cost cap is enforced only when a rate is set: with no rate there is nothing to add up.
    const costGuard =
      rate !== null && cap.monthlyCostIdr !== null
        ? { costIdr: { lte: money(cap.monthlyCostIdr - rate) } }
        : {};
    await this.prisma.waCostCounter.createMany({
      data: [{ waNumber, monthKey, category }],
      skipDuplicates: true,
    });
    const { count } = await this.prisma.waCostCounter.updateMany({
      where: { waNumber, monthKey, category, messages: { lt: cap.monthlyMessages }, ...costGuard },
      data: { messages: { increment: 1 }, costIdr: { increment: rate ?? 0 } },
    });
    if (count !== 1) return { ok: false, reason: 'CAP' };
    const row = await this.prisma.waCostCounter.findUniqueOrThrow({
      where: { waNumber_monthKey_category: { waNumber, monthKey, category } },
    });
    return {
      ok: true,
      messages: row.messages,
      costIdr: Number(row.costIdr.toString()),
      warn: row.messages >= warnThreshold(cap.monthlyMessages),
      reachesCap: row.messages >= cap.monthlyMessages,
    };
  }

  async release(waNumber: string, monthKey: string, category: WaCategory): Promise<void> {
    const cap = await this.getCap(waNumber, category);
    // ponytail: gives back the rate as it is NOW; a rate edited between reserve and release leaves the cost off by the difference.
    const rate = cap ? (rateFor(category, cap) ?? 0) : 0;
    await this.prisma.waCostCounter.updateMany({
      where: { waNumber, monthKey, category, messages: { gt: 0 }, costIdr: { gte: rate } },
      data: { messages: { decrement: 1 }, costIdr: { decrement: rate } },
    });
  }

  async markWarned(waNumber: string, monthKey: string, category: WaCategory, at: Date): Promise<boolean> {
    const { count } = await this.prisma.waCostCounter.updateMany({
      where: { waNumber, monthKey, category, warnedAt: null },
      data: { warnedAt: at },
    });
    return count === 1;
  }

  async markStopped(waNumber: string, monthKey: string, category: WaCategory, at: Date): Promise<boolean> {
    const { count } = await this.prisma.waCostCounter.updateMany({
      where: { waNumber, monthKey, category, stoppedAt: null },
      data: { stoppedAt: at },
    });
    return count === 1;
  }

  async listCounters(monthKey: string): Promise<WaCounterRecord[]> {
    const rows = await this.prisma.waCostCounter.findMany({ where: { monthKey }, take: 50 });
    return rows.map((r) => ({ ...r, costIdr: Number(r.costIdr.toString()) }));
  }
}

/** Approval state of the Meta templates; the event-to-template map itself is code (WA_TEMPLATE_SPECS). */
@Injectable()
export class WaTemplatePrismaRepository implements WaTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<WaTemplateRecord[]> {
    return this.prisma.waTemplate.findMany({ orderBy: { name: 'asc' }, take: 100 });
  }

  async ensure(template: {
    name: string;
    language: string;
    event: string | null;
    category: string;
    bodyParams: number;
  }): Promise<void> {
    await this.prisma.waTemplate.createMany({ data: [template], skipDuplicates: true });
  }

  async setStatus(name: string, language: string, status: string, reason: string | null): Promise<boolean> {
    const { count } = await this.prisma.waTemplate.updateMany({
      where: { name, language },
      data: { status, statusReason: reason },
    });
    return count === 1;
  }
}
