import { TaxSettingsService } from '../../src/application/services/tax-settings.service';
import {
  TaxSettingsInput,
  TaxSettingsRecord,
  TaxSettingsRepository,
} from '../../src/application/ports/tax-settings.repository';
import { TaxRounding } from '../../src/domain/tax';

class InMemoryTaxSettingsRepository implements TaxSettingsRepository {
  row: TaxSettingsRecord | null = null;
  async get(): Promise<TaxSettingsRecord | null> {
    return this.row ? { ...this.row } : null;
  }
  async upsert(input: TaxSettingsInput): Promise<TaxSettingsRecord> {
    this.row = { ...input, updatedAt: new Date() };
    return { ...this.row };
  }
}

describe('TaxSettingsService', () => {
  const sample: TaxSettingsInput = {
    ppnPercent: 12,
    priceIncludesTax: false,
    taxRounding: TaxRounding.HALF_EVEN,
    invoiceFormat: 'INV/{YYYY}/{SEQ}',
    companyName: 'PT Uji',
    npwp: '01.111.222.3-444.000',
    address: 'Jl. Uji 1',
  };

  it('returns editable defaults before anything is saved', async () => {
    const service = new TaxSettingsService(new InMemoryTaxSettingsRepository());
    const settings = await service.get();
    expect(settings.ppnPercent).toBe(11);
    expect(settings.priceIncludesTax).toBe(true);
    expect(settings.updatedAt).toBeNull();
  });

  it('persists an update and returns it on the next get (singleton)', async () => {
    const repo = new InMemoryTaxSettingsRepository();
    const service = new TaxSettingsService(repo);
    const saved = await service.update(sample);
    expect(saved.ppnPercent).toBe(12);
    expect(saved.updatedAt).not.toBeNull();

    const reread = await service.get();
    expect(reread.companyName).toBe('PT Uji');
    expect(reread.priceIncludesTax).toBe(false);
    expect(reread.taxRounding).toBe(TaxRounding.HALF_EVEN);
  });

  it('defaults the rounding method to PER-11/2025 half-up (M29-10)', async () => {
    const service = new TaxSettingsService(new InMemoryTaxSettingsRepository());
    expect((await service.get()).taxRounding).toBe(TaxRounding.HALF_UP);
  });

  it('keeps the legal default when a client omits the rounding method (M29-10)', async () => {
    const service = new TaxSettingsService(new InMemoryTaxSettingsRepository());
    const withoutRounding = { ...sample };
    delete (withoutRounding as { taxRounding?: TaxRounding }).taxRounding;
    const saved = await service.update(withoutRounding);
    expect(saved.taxRounding).toBe(TaxRounding.HALF_UP);
  });

  /*
   * CA-2-63: omitting the field kept the DEFAULT, which is not the same as keeping the
   * VALUE — and the difference is the bug.
   *
   * The console's own tax form has no rounding control, so every save it makes omits the
   * field. A tax admin who had deliberately chosen HALF_EVEN had it silently reverted by
   * the next edit of any other setting: the method could be changed and could not be kept.
   *
   * The test above still holds, and has to: an EMPTY store has no value to keep, and the
   * legal default is the right answer there. That is why it never caught this.
   */
  it('keeps a stored rounding method when a later save omits it', async () => {
    const repo = new InMemoryTaxSettingsRepository();
    const service = new TaxSettingsService(repo);
    await service.update({ ...sample, taxRounding: TaxRounding.HALF_EVEN });

    const withoutRounding = { ...sample, companyName: 'PT Uji Baru' };
    delete (withoutRounding as { taxRounding?: TaxRounding }).taxRounding;
    const saved = await service.update(withoutRounding);

    expect(saved.taxRounding).toBe(TaxRounding.HALF_EVEN);
    expect(saved.companyName).toBe('PT Uji Baru');
  });

  it('still lets a client change the method on purpose', async () => {
    const repo = new InMemoryTaxSettingsRepository();
    const service = new TaxSettingsService(repo);
    await service.update({ ...sample, taxRounding: TaxRounding.HALF_EVEN });

    const saved = await service.update({ ...sample, taxRounding: TaxRounding.HALF_UP });

    expect(saved.taxRounding).toBe(TaxRounding.HALF_UP);
  });
});
