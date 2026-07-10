import { Injectable, Logger } from '@nestjs/common';

import { OtpDeliveryPort, OtpMessage } from '../../application/ports/otp-delivery.port';

/**
 * Development-only OTP channel: writes the code to the application log instead of
 * sending it. Selected via OTP_DELIVERY_CHANNEL=console. Never use in production —
 * config validation should point production at whatsapp/sms.
 */
@Injectable()
export class ConsoleOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger(ConsoleOtpDeliveryAdapter.name);

  async send(message: OtpMessage): Promise<void> {
    this.logger.warn(
      `[DEV OTP] ${message.purpose} code for ${message.phone}: ${message.code} ` +
        `(valid ${message.ttlSeconds}s)`,
    );
  }
}
