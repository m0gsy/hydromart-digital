import { TaxSettingsService } from '../../src/application/services/tax-settings.service';
import {
  TaxSettingsInput,
  TaxSettingsRecord,
  TaxSettingsRepository,
} from '../../src/application/ports/tax-settings.repository';

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
  });
});
