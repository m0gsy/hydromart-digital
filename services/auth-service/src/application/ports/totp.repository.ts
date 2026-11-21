/** HD-4: one person's authenticator, as stored. The secret is sealed (see security/totp.ts). */
export interface TotpCredentialRecord {
  customerId: string;
  secretSealed: string;
  /** Null until the first code proves the app holds the secret: not enrolled yet. */
  confirmedAt: Date | null;
  /** The newest 30-second step accepted, so one code never works twice. */
  lastStep: number | null;
  failedAttempts: number;
  lockedUntil: Date | null;
}

/**
 * Every write that guards something is one conditional statement, so two requests racing
 * with the same code or the same recovery code cannot both win.
 */
export interface TotpRepository {
  find(customerId: string): Promise<TotpCredentialRecord | null>;
  /**
   * Replaces an unconfirmed enrolment with a new secret. False when a CONFIRMED one exists:
   * that one only goes through a reset.
   */
  startEnrolment(customerId: string, secretSealed: string): Promise<boolean>;
  /**
   * Confirms the pending enrolment at `step` and stores the recovery-code hashes, in one
   * transaction. False when it was already confirmed (or is gone) by the time this ran.
   */
  confirm(customerId: string, step: number, at: Date, recoveryCodeHashes: string[]): Promise<boolean>;
  /** Accepts `step` when it is newer than the last accepted one, and clears the failures. */
  acceptStep(customerId: string, step: number): Promise<boolean>;
  /** Spends one unused recovery code, and clears the failures. False when there was none. */
  spendRecoveryCode(customerId: string, codeHash: string, at: Date): Promise<boolean>;
  countRecoveryCodesLeft(customerId: string): Promise<number>;
  /**
   * Claims one try BEFORE a code is compared, in one conditional write, so parallel guesses
   * cannot all slip in under the limit. Returns the try's number since the last good code,
   * or null while the step is locked (or the authenticator is gone).
   */
  claimAttempt(customerId: string, now: Date): Promise<number | null>;
  /** Locks the step until `until`; the count of tries starts again from zero. */
  lock(customerId: string, until: Date): Promise<void>;
  /** Removes the authenticator and its recovery codes. False when there was none. */
  remove(customerId: string): Promise<boolean>;
}
