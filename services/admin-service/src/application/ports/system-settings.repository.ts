export interface SystemSettingsRecord {
  defaultTimezone: string;
  currency: string;
  serviceRadiusKm: number;
  updatedAt: Date;
}

/** Full replacement of the singleton settings (PUT semantics). */
export interface SaveSystemSettingsData {
  defaultTimezone: string;
  currency: string;
  serviceRadiusKm: number;
}

export interface SystemSettingsRepository {
  /** Read the singleton settings, or null when it has never been written. */
  get(): Promise<SystemSettingsRecord | null>;
  /** Create-or-replace the singleton settings. */
  save(data: SaveSystemSettingsData): Promise<SystemSettingsRecord>;
}
