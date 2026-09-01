import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';

export interface OtpMessage {
  phone: string;
  code: string;
  purpose: OtpPurpose;
  ttlSeconds: number;
}

/**
 * Port for delivering an OTP to the customer's phone. Concrete adapters send via
 * an SMS gateway, or (in development) the log. The application layer never knows
 * which channel is used.
 */
export interface OtpDeliveryPort {
  send(message: OtpMessage): Promise<void>;
}

/*
 * Two failures, and the caller must be able to tell them apart.
 *
 * A gateway that ANSWERS with a rejection has definitely not sent anything: the challenge
 * can be thrown away so the customer may ask for another code straight away.
 *
 * A gateway that does not answer in time may have sent it anyway. Throwing the challenge
 * away there would invalidate a code already on the phone, and the customer would type a
 * number that has just been deleted. So the two get different types, and the service acts
 * differently on each.
 */
export class OtpGatewayRejectedError extends Error {
  constructor(detail: string) {
    super(`OTP gateway rejected the send: ${detail}`);
    this.name = OtpGatewayRejectedError.name;
  }
}

export class OtpGatewayUnreachableError extends Error {
  constructor(detail: string) {
    super(`OTP gateway did not answer: ${detail}`);
    this.name = OtpGatewayUnreachableError.name;
  }
}
