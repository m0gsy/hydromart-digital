import { Inject, Injectable } from '@nestjs/common';
import { SettingsCache, SettingsSliceService } from '@hydromart/platform';

import { SETTINGS_REPOSITORY, SettingsRepository } from '../ports/settings.repository';
import { SETTING_DEFS, SETTING_DEF_BY_KEY } from '../../config/setting-defs';

/**
 * Q-1: the whole body of this class used to be copied into seven services,
 * byte-identical. It now lives in @hydromart/platform; what stays here is the one
 * thing that was ever different — which defs table this service owns.
 */
@Injectable()
export class SettingsService extends SettingsSliceService {
  constructor(
    @Inject(SETTINGS_REPOSITORY) repo: SettingsRepository,
    cache: SettingsCache,
  ) {
    super(repo, cache, SETTING_DEFS, SETTING_DEF_BY_KEY);
  }
}
