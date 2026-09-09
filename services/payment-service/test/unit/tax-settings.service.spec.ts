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

  /*
   * CA-2-52 — owner decision 2026-09-04: not PKP yet, so nothing tax-shaped is built.
   *
   * The default used to be 11. There is no seed row for `tax_settings` and no SQL default
   * on the column, so on an untouched database this served 11 and the invoice screen
   * printed a "PPN 11%" line and an NPWP header over a real customer's real order, with a
   * Print button. Nobody switched that on. It was on.
   */
  it('serves no tax rate until somebody sets one', async () => {
    const service = new TaxSettingsService(new InMemoryTaxSettingsRepository());
    const settings = await service.get();
    expect(settings.ppnPercent).toBe(0);
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
    const first = await service.update({ ...sample, taxRounding: TaxRounding.HALF_EVEN });

    const withoutRounding = { ...sample, companyName: 'PT Uji Baru' };
    delete (withoutRounding as { taxRounding?: TaxRounding }).taxRounding;
    // CA-2-53: a second save now has to say which version it started from.
    const saved = await service.update(withoutRounding, first.updatedAt!.toISOString());

    expect(saved.taxRounding).toBe(TaxRounding.HALF_EVEN);
    expect(saved.companyName).toBe('PT Uji Baru');
  });

  it('still lets a client change the method on purpose', async () => {
    const repo = new InMemoryTaxSettingsRepository();
    const service = new TaxSettingsService(repo);
    const first = await service.update({ ...sample, taxRounding: TaxRounding.HALF_EVEN });

    const saved = await service.update(
      { ...sample, taxRounding: TaxRounding.HALF_UP },
      first.updatedAt!.toISOString(),
    );

    expect(saved.taxRounding).toBe(TaxRounding.HALF_UP);
  });

  /*
   * CA-2-53. Two finance admins hold /hq/tax open; the second save used to erase the
   * first's rate with neither of them told — on the row that decides what is printed on a
   * customer's invoice.
   */
  it('refuses a save built on a copy that is already out of date', async () => {
    const repo = new InMemoryTaxSettingsRepository();
    const service = new TaxSettingsService(repo);
    const first = await service.update(sample);
    await expect(
      service.update(
        { ...sample, ppnPercent: 0 },
        new Date(first.updatedAt!.getTime() - 1000).toISOString(),
      ),
    ).rejects.toMatchObject({ code: 'STALE_WRITE', status: 409 });
    expect((await service.get()).ppnPercent).toBe(12);
  });

  it('accepts a save from someone looking at the current row', async () => {
    const repo = new InMemoryTaxSettingsRepository();
    const service = new TaxSettingsService(repo);
    const first = await service.update(sample);
    const second = await service.update(
      { ...sample, ppnPercent: 0 },
      first.updatedAt!.toISOString(),
    );
    expect(second.ppnPercent).toBe(0);
  });

  it('refuses a save that says nothing about what it saw, once a row exists', async () => {
    // Fails closed. The first save, on an empty table, is allowed through — there is
    // nothing to lose, and the settings page has to be savable before it has been saved.
    const service = new TaxSettingsService(new InMemoryTaxSettingsRepository());
    await service.update(sample);
    await expect(service.update({ ...sample, ppnPercent: 5 })).rejects.toMatchObject({
      code: 'STALE_WRITE',
    });
  });
});
