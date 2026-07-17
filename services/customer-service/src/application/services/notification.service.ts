import { Inject, Injectable } from '@nestjs/common';

import {
  NotificationPreferenceRecord,
  NotificationPreferenceRepository,
} from '../ports/notification.repository';
import { CUSTOMER_TOKENS } from '../tokens';

/** Per-customer notification channel preferences. Defaults to all-on. */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(CUSTOMER_TOKENS.NotificationPreferenceRepository)
    private readonly prefs: NotificationPreferenceRepository,
  ) {}

  async get(customerId: string): Promise<NotificationPreferenceRecord> {
    const existing = await this.prefs.findByCustomerId(customerId);
    return existing ?? { customerId, push: true, email: true, whatsapp: true, categories: {} };
  }

  async update(
    customerId: string,
    patch: Partial<Pick<NotificationPreferenceRecord, 'push' | 'email' | 'whatsapp' | 'categories'>>,
  ): Promise<NotificationPreferenceRecord> {
    const current = await this.get(customerId);
    return this.prefs.upsert({
      customerId,
      push: patch.push ?? current.push,
      email: patch.email ?? current.email,
      whatsapp: patch.whatsapp ?? current.whatsapp,
      // Category patch merges over the stored map so one toggle doesn't wipe the rest.
      categories: patch.categories ? { ...current.categories, ...patch.categories } : current.categories,
    });
  }
}
