import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';

export interface OtpMessage {
  phone: string;
  code: string;
  purpose: OtpPurpose;
  ttlSeconds: number;
}

/**
 * Port for delivering an OTP to the customer's phone. Concrete adapters send via
 * WhatsApp Business API, an SMS gateway, or (in development) the log. The
 * application layer never knows which channel is used.
 */
export interface OtpDeliveryPort {
  send(message: OtpMessage): Promise<void>;
}
