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
});
