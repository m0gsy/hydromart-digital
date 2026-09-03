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

  /**
   * CA-2-63: omitting the rounding method keeps what is STORED, not the default.
   *
   * The line here used to read `input.taxRounding ?? DEFAULT_TAX_ROUNDING`, and the comment
   * above it said that kept "the legal default rather than clearing it". Both halves were
   * true and together they were the bug: keeping the default is not keeping the value. A
   * tax admin who had deliberately chosen a different rounding method had it silently
   * reverted by the NEXT save of any other field — and the console's own tax form has no
   * rounding control at all, so every save it makes omits the field. The setting could be
   * changed and could not be kept.
   *
   * Falling back to the default only when there is no stored row is the difference between
   * "we do not know yet" and "you did not mention it this time".
   */
  async update(
    input: Omit<TaxSettingsInput, 'taxRounding'> & { taxRounding?: TaxRounding },
  ): Promise<TaxSettingsRecord> {
    const stored = await this.repo.get();
    return this.repo.upsert({
      ...input,
      taxRounding: input.taxRounding ?? stored?.taxRounding ?? DEFAULT_TAX_ROUNDING,
    });
  }
}
