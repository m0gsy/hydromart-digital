export const FACE_MAINTENANCE_REPOSITORY = Symbol('FACE_MAINTENANCE_REPOSITORY');

/** One shadow comparison: the local engine's answer beside NEO's, for the same punch. */
export interface FaceShadowSample {
  employeeId: string;
  neoScore: number;
  neoMatched: boolean;
  /** Null unless the local engine produced a score. */
  localScore: number | null;
  outcome: 'scored' | 'no-template' | 'no-face' | 'bad-image' | 'failed';
}

/**
 * The daily face upkeep (owner decision 2026-11-21): what HR says is enrolled, checked against
 * the engine's gallery, and the shadow samples the local threshold is set from.
 */
export interface FaceMaintenanceRepository {
  /** Active enrolments, with when each was made: the faces the engine's gallery should hold. */
  activeEnrolments(): Promise<{ employeeId: string; createdAt: Date }[]>;
  /**
   * Employees whose consent was stamped since `since`. Every enrolment stamps it BEFORE the
   * engine is called, so this names the enrolments that may still be in flight.
   */
  consentedSince(since: Date): Promise<string[]>;
  recordShadowSample(sample: FaceShadowSample): Promise<void>;
  /** Delete samples taken before `before`; how many went. */
  purgeShadowSamples(before: Date): Promise<number>;
}
