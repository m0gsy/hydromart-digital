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
    expect(s).toMatchObject({ defaultTimezone: 'Asia/Jakarta', currency: 'IDR', serviceRadiusKm: 5 });
  });

  it('saves and then reads back the saved settings', async () => {
    await service.save({ defaultTimezone: 'Asia/Makassar', currency: 'IDR', serviceRadiusKm: 8 });
    const s = await service.get();
    expect(s).toMatchObject({ defaultTimezone: 'Asia/Makassar', serviceRadiusKm: 8 });
  });
});
