import { SettingRow, SettingsSource } from '@hydromart/platform';

export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');

export interface SettingsRepository extends SettingsSource {
  upsert(row: SettingRow & { updatedBy: string }): Promise<void>;
  remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void>;
}
