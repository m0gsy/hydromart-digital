export interface SlaPolicyRecord {
  onTimeThresholdMinutes: number;
  healthyBandPct: number;
  criticalBandPct: number;
  updatedAt: Date;
}

/** Full replacement of the singleton policy (PUT semantics). */
export interface SaveSlaPolicyData {
  onTimeThresholdMinutes: number;
  healthyBandPct: number;
  criticalBandPct: number;
}

export interface SlaPolicyRepository {
  /** Read the singleton policy, or null when it has never been written. */
  get(): Promise<SlaPolicyRecord | null>;
  /** Create-or-replace the singleton policy. */
  save(data: SaveSlaPolicyData): Promise<SlaPolicyRecord>;
}
