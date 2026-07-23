// Per-depot editable business settings (business/settings-editor plan). Global
// default + per-depot override for tunables the server would otherwise read from
// env (delivery-service today; slices 2-5 append more service rows).
import { api } from './api';

export interface SettingDef {
  key: string;
  label: string;
  type: 'int' | 'number' | 'money' | 'string';
  unit?: string;
  min?: number;
  max?: number;
  envDefault: number | string;
}

export interface SettingsSchema {
  defs: SettingDef[];
  effective: Record<string, number | string>;
}

export type SettingScope = 'GLOBAL' | 'DEPOT';

// One row per service that exposes GET /settings/schema behind the gateway.
export const SETTINGS_SERVICES = [
  { id: 'delivery', label: 'Pengiriman & Kurir', base: '/deliveries/api/v1' },
  { id: 'order', label: 'Order & Ongkir', base: '/orders/api/v1' },
] as const;

export function fetchSettingsSchema(base: string, depotId: string | null): Promise<SettingsSchema> {
  const q = depotId ? `?depotId=${encodeURIComponent(depotId)}` : '';
  return api.get<SettingsSchema>(`${base}/settings/schema${q}`, true);
}

export function putSetting(
  base: string,
  body: { scope: SettingScope; depotId?: string; key: string; value: string },
): Promise<void> {
  return api.put(`${base}/settings`, body, true);
}

export function resetSetting(
  base: string,
  body: { scope: SettingScope; depotId?: string; key: string },
): Promise<void> {
  return api.del(`${base}/settings`, body, true);
}
