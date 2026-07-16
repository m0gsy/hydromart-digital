import { Inject, Injectable } from '@nestjs/common';

import {
  TaxSettingsInput,
  TaxSettingsRecord,
  TaxSettingsRepository,
} from '../ports/tax-settings.repository';
import { PAYMENT_TOKENS } from '../tokens';

/**
 * Defaults returned before HQ has saved any tax settings. These are editable config
 * defaults, not fabricated runtime data — the finance admin overrides them via PUT.
 */
const DEFAULTS: TaxSettingsRecord = {
  ppnPercent: 11,
  priceIncludesTax: true,
  invoiceFormat: 'HM/{YYYY}/{MM}/{SEQ}',
  companyName: 'PT Hydromart Nusantara',
  npwp: '',
  address: '',
  updatedAt: null,
};

/** Tax & invoice settings (feature 19f), one active row; feeds the invoice preview (24d). */
@Injectable()
export class TaxSettingsService {
  constructor(
    @Inject(PAYMENT_TOKENS.TaxSettingsRepository)
    private readonly repo: TaxSettingsRepository,
  ) {}

  async get(): Promise<TaxSettingsRecord> {
    return (await this.repo.get()) ?? DEFAULTS;
  }

  async update(input: TaxSettingsInput): Promise<TaxSettingsRecord> {
    return this.repo.upsert(input);
  }
}
