import { Injectable } from '@nestjs/common';

import { PricingAdjustType, PricingRuleRecord } from '../../domain/pricing-rule';
import {
  CreatePricingRuleData,
  PricingRuleRepository,
  UpdatePricingRuleData,
} from '../../application/ports/pricing-rule.repository';
import { PrismaService } from './prisma.service';

interface RuleRow {
  id: string;
  depotId: string;
  productId: string | null;
  adjustType: string;
  value: unknown; // Prisma Decimal
  daysOfWeek: number[];
  startMinute: number | null;
  endMinute: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  priority: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PricingRulePrismaRepository implements PricingRuleRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRule(row: RuleRow): PricingRuleRecord {
    return {
      id: row.id,
      depotId: row.depotId,
      productId: row.productId,
      adjustType: row.adjustType as PricingAdjustType,
      value: Number(row.value),
      daysOfWeek: row.daysOfWeek,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      priority: row.priority,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreatePricingRuleData): Promise<PricingRuleRecord> {
    const row = await this.prisma.pricingRule.create({ data });
    return this.toRule(row as unknown as RuleRow);
  }

  async findById(id: string): Promise<PricingRuleRecord | null> {
    const row = await this.prisma.pricingRule.findUnique({ where: { id } });
    return row ? this.toRule(row as unknown as RuleRow) : null;
  }

  async listForDepot(depotId: string): Promise<PricingRuleRecord[]> {
    const rows = await this.prisma.pricingRule.findMany({
      where: { depotId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toRule(r as unknown as RuleRow));
  }

  async listActiveForDepot(depotId: string): Promise<PricingRuleRecord[]> {
    const rows = await this.prisma.pricingRule.findMany({ where: { depotId, active: true } });
    return rows.map((r) => this.toRule(r as unknown as RuleRow));
  }

  async update(id: string, patch: UpdatePricingRuleData): Promise<PricingRuleRecord> {
    const row = await this.prisma.pricingRule.update({ where: { id }, data: patch });
    return this.toRule(row as unknown as RuleRow);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.pricingRule.delete({ where: { id } });
  }
}
