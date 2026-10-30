import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';

export interface OtpTokenRecord {
  id: string;
  customerId: string;
  purpose: OtpPurpose;
  codeHash: string;
  /**
   * K1.4: where this code was SENT, when that is not the account's current number. Null
   * for every other purpose. The confirm step reads the destination from HERE rather than
   * from the request body — a code only ever proves control of wherever it was delivered.
   */
  targetPhone: string | null;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface CreateOtpTokenData {
  customerId: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
  /** K1.4. Omitted for a challenge delivered to the account's own number. */
  targetPhone?: string | null;
}

/** Persistence port for OTP challenges. */
export interface OtpTokenRepository {
  create(data: CreateOtpTokenData): Promise<OtpTokenRecord>;
  /**
   * The resend gate and the insert as ONE step per customer + purpose (advisory lock). Two
   * resends at once both found no active code, both issued one, and both sent an SMS: the
   * cooldown only held for requests that arrived in sequence.
   *
   * Inside the lock: an active challenge younger than `cooldownSeconds` answers
   * `{ cooldownRemaining }` and nothing is written; otherwise every outstanding challenge is
   * invalidated and the new one stored.
   */
  issueExclusive(
    data: CreateOtpTokenData,
    cooldownSeconds: number,
    now: Date,
  ): Promise<{ cooldownRemaining: number } | { token: OtpTokenRecord }>;
  /** Most recent, not-yet-consumed challenge for a customer + purpose. */
  findActive(customerId: string, purpose: OtpPurpose): Promise<OtpTokenRecord | null>;
  /**
   * Reserve one guess against the challenge: increment `attempts` only while it is still
   * below `maxAttempts` and the challenge is unconsumed, in a single conditional write.
   * Returns false when there was nothing left to claim — that is the attempt limit, and it
   * must hold for parallel requests, not just sequential ones.
   */
  claimAttempt(id: string, maxAttempts: number): Promise<boolean>;
  /**
   * Burns the challenge — and says whether THIS call did. False when it was already consumed.
   *
   * A code is single-use, but `verify` only read `consumedAt` before comparing, so two parallel
   * requests carrying the right code both got past it and both minted a session. The write
   * itself has to be the claim.
   */
  markConsumed(id: string, consumedAt: Date): Promise<boolean>;
  /** Invalidate all outstanding challenges for a customer + purpose. */
  consumeAllForPurpose(customerId: string, purpose: OtpPurpose, at: Date): Promise<void>;
}
