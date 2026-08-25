import { NotificationService } from '../../src/application/services/notification.service';
import {
  NotificationPreferenceRecord,
  NotificationPreferenceRepository,
} from '../../src/application/ports/notification.repository';

class InMemoryNotificationPreferenceRepository implements NotificationPreferenceRepository {
  private rows = new Map<string, NotificationPreferenceRecord>();

  async findByCustomerId(customerId: string): Promise<NotificationPreferenceRecord | null> {
    return this.rows.get(customerId) ?? null;
  }
  async upsert(record: NotificationPreferenceRecord): Promise<NotificationPreferenceRecord> {
    this.rows.set(record.customerId, record);
    return record;
  }
}

describe('NotificationService', () => {
  let repo: InMemoryNotificationPreferenceRepository;
  let service: NotificationService;
  const CUST = 'cust-1';

  beforeEach(() => {
    repo = new InMemoryNotificationPreferenceRepository();
    service = new NotificationService(repo);
  });

  it('defaults to all-channels-on for a customer with no stored prefs', async () => {
    expect(await service.get(CUST)).toEqual({
      customerId: CUST,
      push: true,
      email: true,
      whatsapp: true,
      categories: {},
      locale: 'id',
    });
  });

  it('persists a channel toggle without touching the others', async () => {
    const updated = await service.update(CUST, { whatsapp: false });
    expect(updated).toMatchObject({ push: true, email: true, whatsapp: false });
    // Re-reading returns the persisted row, not the default.
    expect(await service.get(CUST)).toMatchObject({ whatsapp: false });
  });

  it('merges a category patch over the stored map instead of replacing it', async () => {
    await service.update(CUST, { categories: { promo: false } });
    const updated = await service.update(CUST, { categories: { reminder: false } });
    // Both mutes survive — one toggle must not wipe the rest.
    expect(updated.categories).toEqual({ promo: false, reminder: false });
  });

  // K5.3: the language the SENDER reads. crm renders WhatsApp and push server-side and has
  // no browser to ask, so a choice that stays in localStorage reaches nobody.
  it('persists the message language and leaves the channels alone', async () => {
    const updated = await service.update(CUST, { locale: 'en' });
    expect(updated).toMatchObject({ locale: 'en', push: true, whatsapp: true });
    expect(await service.get(CUST)).toMatchObject({ locale: 'en' });
  });

  it('keeps the stored language when an unrelated toggle is patched', async () => {
    await service.update(CUST, { locale: 'en' });
    expect(await service.update(CUST, { push: false })).toMatchObject({ locale: 'en' });
  });

  it('a later category patch overrides the same key', async () => {
    await service.update(CUST, { categories: { promo: false } });
    const updated = await service.update(CUST, { categories: { promo: true } });
    expect(updated.categories).toEqual({ promo: true });
  });
});
