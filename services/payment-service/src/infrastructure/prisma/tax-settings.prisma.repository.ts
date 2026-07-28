import { Injectable } from '@nestjs/common';

import {
  TaxSettingsInput,
  TaxSettingsRecord,
  TaxSettingsRepository,
} from '../../application/ports/tax-settings.repository';
import { DEFAULT_TAX_ROUNDING, isTaxRounding } from '../../domain/tax';
import { PrismaService } from './prisma.service';

type Decimalish = { toNumber(): number };

interface TaxSettingsRow {
  id: string;
  ppnPercent: Decimalish;
  priceIncludesTax: boolean;
  taxRounding: string;
  invoiceFormat: string;
  companyName: string;
  npwp: string;
  address: string;
  updatedAt: Date;
}

@Injectable()
export class TaxSettingsPrismaRepository implements TaxSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: TaxSettingsRow): TaxSettingsRecord {
    return {
      ppnPercent: row.ppnPercent.toNumber(),
      priceIncludesTax: row.priceIncludesTax,
      // A row written before this column existed, or hand-edited, falls back to the
      // legal default rather than propagating an unknown method into money maths.
      taxRounding: isTaxRounding(row.taxRounding) ? row.taxRounding : DEFAULT_TAX_ROUNDING,
      invoiceFormat: row.invoiceFormat,
      companyName: row.companyName,
      npwp: row.npwp,
      address: row.address,
      updatedAt: row.updatedAt,
    };
  }

  async get(): Promise<TaxSettingsRecord | null> {
    const row = await this.prisma.taxSettings.findFirst({ orderBy: { updatedAt: 'desc' } });
    return row ? this.toRecord(row) : null;
  }

  async upsert(input: TaxSettingsInput): Promise<TaxSettingsRecord> {
    // Singleton: reuse the one existing row if present, otherwise create it.
    const existing = await this.prisma.taxSettings.findFirst();
    const row = existing
      ? await this.prisma.taxSettings.update({ where: { id: existing.id }, data: input })
      : await this.prisma.taxSettings.create({ data: input });
    return this.toRecord(row);
  }
}
