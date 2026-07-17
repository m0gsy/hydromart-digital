export interface TaxSettingsRecord {
  ppnPercent: number;
  priceIncludesTax: boolean;
  invoiceFormat: string;
  companyName: string;
  npwp: string;
  address: string;
  /** Null when no row has been saved yet (service defaults are returned). */
  updatedAt: Date | null;
}

export type TaxSettingsInput = Omit<TaxSettingsRecord, 'updatedAt'>;

/** Singleton tax & invoice settings (feature 19f). At most one row. */
export interface TaxSettingsRepository {
  get(): Promise<TaxSettingsRecord | null>;
  upsert(input: TaxSettingsInput): Promise<TaxSettingsRecord>;
}
