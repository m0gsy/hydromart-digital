import { Injectable, Logger } from '@nestjs/common';

import {
  OtpDeliveryPort,
  OtpGatewayRejectedError,
  OtpGatewayUnreachableError,
  OtpMessage,
} from '../../application/ports/otp-delivery.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * Delivers OTP codes via a generic SMS gateway (token-authenticated REST endpoint).
 * Selected via OTP_DELIVERY_CHANNEL=sms.
 */
@Injectable()
export class SmsOtpDeliveryAdapter implements OtpDeliveryPort {
  /*
   * The same 8 seconds the Zenziva adapter uses, and for the same reason: this call sits
   * inside a request the web client abandons after 15, so an unbounded one guarantees the
   * browser gives up first and the customer is told the server was too slow while the SMS
   * goes out anyway.
   *
   * This had NO deadline at all — worse than the 15s that caused the reported bug, because
   * a hung gateway held the request until something else gave up. Latent only because
   * production runs the Zenziva channel.
   */
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(SmsOtpDeliveryAdapter.name);

  constructor(private readonly config: AuthConfigService) {}

  async send(message: OtpMessage): Promise<void> {
    const { baseUrl, token, senderId } = this.config.sms;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SmsOtpDeliveryAdapter.TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/messages`, {
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
        signal: controller.signal,
      });
    } catch (error) {
      // Aborted or unreachable: the gateway may have taken it anyway, so the caller must not
      // throw away a challenge whose code could already be on the phone.
      throw new OtpGatewayUnreachableError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`SMS OTP delivery failed (${response.status}): ${detail}`);
      // An answer, and the answer was no: nothing was sent, so the challenge can go and the
      // customer may ask again without waiting out the resend cooldown.
      throw new OtpGatewayRejectedError(`SMS gateway answered HTTP ${response.status}`);
    }
  }
}
