import { Inject, Injectable } from '@nestjs/common';
import { assertFresh } from '@hydromart/platform';

import {
  SaveSystemSettingsData,
  SystemSettingsRecord,
  SystemSettingsRepository,
} from '../ports/system-settings.repository';
import { ADMIN_TOKENS } from '../tokens';

// Platform defaults returned before an admin has ever saved settings (Design 8b). These
// are real defaults, not fabricated data — they mirror the DB column defaults so GET is
// never empty and PUT starts from a sensible baseline.
const DEFAULTS: SaveSystemSettingsData = {
  defaultTimezone: 'Asia/Jakarta',
  currency: 'IDR',
  serviceRadiusKm: 5,
};

@Injectable()
export class SystemSettingsService {
  constructor(
    @Inject(ADMIN_TOKENS.SystemSettingsRepository)
    private readonly repo: SystemSettingsRepository,
  ) {}

  /** Current platform settings, falling back to platform defaults when unset. */
  async get(): Promise<SystemSettingsRecord> {
    const existing = await this.repo.get();
    return existing ?? { ...DEFAULTS, updatedAt: new Date(0) };
  }

  /**
   * Replace the singleton settings (PUT).
   *
   * AAS-13: refused when the caller's copy is older than the stored row (or names none): the same
   * guard the other policy stores carry. Nothing was guarding this one.
   */
  async save(data: SaveSystemSettingsData, seenUpdatedAt?: string): Promise<SystemSettingsRecord> {
    assertFresh((await this.repo.get())?.updatedAt ?? null, seenUpdatedAt);
    return this.repo.save(data);
  }
}
