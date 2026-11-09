import { StaleWriteError } from '@hydromart/platform';
import { SystemSettingsService } from '../../src/application/services/system-settings.service';
import { InMemorySystemSettingsRepository } from '../support/fakes';

describe('SystemSettingsService', () => {
  let repo: InMemorySystemSettingsRepository;
  let service: SystemSettingsService;

  beforeEach(() => {
    repo = new InMemorySystemSettingsRepository();
    service = new SystemSettingsService(repo);
  });

  it('returns platform defaults before anything is saved', async () => {
    const s = await service.get();
    expect(s).toMatchObject({
      defaultTimezone: 'Asia/Jakarta',
      currency: 'IDR',
      serviceRadiusKm: 5,
    });
  });

  // AAS-13: this was the one policy store with no stale-write guard at all - two admins saving
  // produced whichever came last. Once a row exists, a save must say which version it started from.
  it('refuses a save built on an older copy, and one that names no version, once settings exist', async () => {
    const first = await service.save({ defaultTimezone: 'Asia/Jakarta', currency: 'IDR', serviceRadiusKm: 5 });
    await expect(
      service.save({ defaultTimezone: 'Asia/Makassar', currency: 'IDR', serviceRadiusKm: 9 }),
    ).rejects.toBeInstanceOf(StaleWriteError);
    await expect(
      service.save(
        { defaultTimezone: 'Asia/Makassar', currency: 'IDR', serviceRadiusKm: 9 },
        new Date(first.updatedAt.getTime() - 5000).toISOString(),
      ),
    ).rejects.toBeInstanceOf(StaleWriteError);
    const ok = await service.save(
      { defaultTimezone: 'Asia/Makassar', currency: 'IDR', serviceRadiusKm: 9 },
      first.updatedAt.toISOString(),
    );
    expect(ok.serviceRadiusKm).toBe(9);
  });

  it('saves and then reads back the saved settings', async () => {
    await service.save({ defaultTimezone: 'Asia/Makassar', currency: 'IDR', serviceRadiusKm: 8 });
    const s = await service.get();
    expect(s).toMatchObject({ defaultTimezone: 'Asia/Makassar', serviceRadiusKm: 8 });
  });
});
