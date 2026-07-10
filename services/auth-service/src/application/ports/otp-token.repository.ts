import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';

export interface OtpTokenRecord {
  id: string;
  customerId: string;
  purpose: OtpPurpose;
  codeHash: string;
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
}

/** Persistence port for OTP challenges. */
export interface OtpTokenRepository {
  create(data: CreateOtpTokenData): Promise<OtpTokenRecord>;
  /** Most recent, not-yet-consumed challenge for a customer + purpose. */
  findActive(customerId: string, purpose: OtpPurpose): Promise<OtpTokenRecord | null>;
  incrementAttempts(id: string): Promise<void>;
  markConsumed(id: string, consumedAt: Date): Promise<void>;
  /** Invalidate all outstanding challenges for a customer + purpose. */
  consumeAllForPurpose(customerId: string, purpose: OtpPurpose, at: Date): Promise<void>;
}
