export interface SecurityPolicyRecord {
  idleTimeoutMinutes: number;
  require2fa: boolean;
  ipAllowlist: string[];
  updatedAt: Date;
}

/** Full replacement of the singleton policy (PUT semantics). */
export interface SaveSecurityPolicyData {
  idleTimeoutMinutes: number;
  require2fa: boolean;
  ipAllowlist: string[];
}

export interface SecurityPolicyRepository {
  /** Read the singleton policy, or null when it has never been written. */
  get(): Promise<SecurityPolicyRecord | null>;
  /** Create-or-replace the singleton policy. */
  /** AAS-13: with `expectedUpdatedAt` the write only lands if the row still carries that stamp (else StaleWriteError). */
  save(data: SaveSecurityPolicyData, expectedUpdatedAt?: Date): Promise<SecurityPolicyRecord>;
}
