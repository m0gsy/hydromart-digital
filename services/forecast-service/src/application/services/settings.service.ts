import { Inject, Injectable } from '@nestjs/common';
import { SettingsCache, SettingsSliceService } from '@hydromart/platform';

import { SETTINGS_REPOSITORY, SettingsRepository } from '../ports/settings.repository';
import { SETTING_DEFS, SETTING_DEF_BY_KEY } from '../../config/setting-defs';

/** The shared slice; what is local is only which defs table this service owns. */
@Injectable()
export class SettingsService extends SettingsSliceService {
  constructor(
    @Inject(SETTINGS_REPOSITORY) repo: SettingsRepository,
    cache: SettingsCache,
  ) {
    super(repo, cache, SETTING_DEFS, SETTING_DEF_BY_KEY);
  }
}
