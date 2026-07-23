import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SettingsCache, coerce } from '@hydromart/platform';

import { SETTINGS_REPOSITORY, SettingsRepository } from '../ports/settings.repository';
import { SETTING_DEFS, SETTING_DEF_BY_KEY, SettingDef } from '../../config/setting-defs';

interface PutInput {
  scope: 'GLOBAL' | 'DEPOT';
  depotId: string | null;
  key: string;
  value: string;
  updatedBy: string;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(SETTINGS_REPOSITORY) private readonly repo: SettingsRepository,
    public readonly cache: SettingsCache,
  ) {}

  async schema(
    depotId: string | null,
  ): Promise<{ defs: SettingDef[]; effective: Record<string, number | string> }> {
    await this.cache.refresh();
    const effective: Record<string, number | string> = {};
    for (const def of SETTING_DEFS) {
      effective[def.key] = this.cache.effective(def.key, def.type, def.envDefault, depotId);
    }
    return { defs: SETTING_DEFS, effective };
  }

  async put(input: PutInput): Promise<void> {
    const def = SETTING_DEF_BY_KEY[input.key];
    if (!def) {
      throw new BadRequestException(`Unknown setting: ${input.key}`);
    }
    if (input.scope === 'DEPOT' && !input.depotId) {
      throw new BadRequestException('depotId required for a DEPOT override');
    }
    const coerced = coerce(input.value, def.type);
    if (def.type !== 'string') {
      const n = coerced as number;
      if (def.min != null && n < def.min) throw new BadRequestException(`${input.key} below min ${def.min}`);
      if (def.max != null && n > def.max) throw new BadRequestException(`${input.key} above max ${def.max}`);
    }
    await this.repo.upsert({
      scope: input.scope,
      depotId: input.scope === 'GLOBAL' ? null : input.depotId,
      key: input.key,
      value: String(coerced),
      updatedBy: input.updatedBy,
    });
    await this.cache.refresh();
  }

  async reset(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    await this.repo.remove(scope, scope === 'GLOBAL' ? null : depotId, key);
    await this.cache.refresh();
  }
}
