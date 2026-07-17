import { FlagState } from '../../domain/flag-state';

export interface FeatureFlagRecord {
  id: string;
  key: string;
  label: string;
  description: string;
  state: FlagState;
  rolloutPct: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields a PATCH may change on a flag (all optional; at least one supplied). */
export interface UpdateFeatureFlagData {
  state?: FlagState;
  rolloutPct?: number | null;
}

export interface FeatureFlagRepository {
  list(): Promise<FeatureFlagRecord[]>;
  findByKey(key: string): Promise<FeatureFlagRecord | null>;
  update(key: string, data: UpdateFeatureFlagData): Promise<FeatureFlagRecord | null>;
}
