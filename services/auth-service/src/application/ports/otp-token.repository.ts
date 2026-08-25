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
  /** Most recent, not-yet-consumed challenge for a customer + purpose. */
  findActive(customerId: string, purpose: OtpPurpose): Promise<OtpTokenRecord | null>;
  /**
   * Reserve one guess against the challenge: increment `attempts` only while it is still
   * below `maxAttempts` and the challenge is unconsumed, in a single conditional write.
   * Returns false when there was nothing left to claim — that is the attempt limit, and it
   * must hold for parallel requests, not just sequential ones.
   */
  claimAttempt(id: string, maxAttempts: number): Promise<boolean>;
  markConsumed(id: string, consumedAt: Date): Promise<void>;
  /** Invalidate all outstanding challenges for a customer + purpose. */
  consumeAllForPurpose(customerId: string, purpose: OtpPurpose, at: Date): Promise<void>;
}
