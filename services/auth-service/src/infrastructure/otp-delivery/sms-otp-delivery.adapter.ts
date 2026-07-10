import { Injectable, Logger } from '@nestjs/common';

import { OtpDeliveryPort, OtpMessage } from '../../application/ports/otp-delivery.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * Delivers OTP codes via a generic SMS gateway (token-authenticated REST endpoint).
 * Selected via OTP_DELIVERY_CHANNEL=sms.
 */
@Injectable()
export class SmsOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger(SmsOtpDeliveryAdapter.name);

  constructor(private readonly config: AuthConfigService) {}

  async send(message: OtpMessage): Promise<void> {
    const { baseUrl, token, senderId } = this.config.sms;

    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: senderId,
        to: message.phone,
        text: `Kode verifikasi Hydromart Anda adalah ${message.code}. Berlaku ${Math.floor(
          message.ttlSeconds / 60,
        )} menit. Jangan bagikan kode ini kepada siapa pun.`,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`SMS OTP delivery failed (${response.status}): ${detail}`);
      throw new Error(`SMS OTP delivery failed with status ${response.status}`);
    }
  }
}
