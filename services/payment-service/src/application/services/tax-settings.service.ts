import { Inject, Injectable } from '@nestjs/common';

import {
  TaxSettingsInput,
  TaxSettingsRecord,
  TaxSettingsRepository,
} from '../ports/tax-settings.repository';
import { PAYMENT_TOKENS } from '../tokens';
import { DEFAULT_TAX_ROUNDING, TaxRounding } from '../../domain/tax';

/**
 * Defaults returned before HQ has saved any tax settings. These are editable config
 * defaults, not fabricated runtime data — the finance admin overrides them via PUT.
 */
const DEFAULTS: TaxSettingsRecord = {
  ppnPercent: 11,
  priceIncludesTax: true,
  taxRounding: DEFAULT_TAX_ROUNDING,
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

  async update(
    input: Omit<TaxSettingsInput, 'taxRounding'> & { taxRounding?: TaxRounding },
  ): Promise<TaxSettingsRecord> {
    // Omitting the rounding method keeps the legal default rather than clearing it —
    // an older client that doesn't know the field must not silently change the maths.
    return this.repo.upsert({ ...input, taxRounding: input.taxRounding ?? DEFAULT_TAX_ROUNDING });
  }
}
