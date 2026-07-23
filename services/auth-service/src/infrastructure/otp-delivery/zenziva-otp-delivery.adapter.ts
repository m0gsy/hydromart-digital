import { Injectable, Logger } from '@nestjs/common';

import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import { OtpDeliveryPort, OtpMessage } from '../../application/ports/otp-delivery.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * Delivers OTP codes over Zenziva's masking SMS API. Selected via
 * OTP_DELIVERY_CHANNEL=zenziva.
 *
 * Two things differ from a plain REST gateway and are the reason this is its own
 * adapter rather than a tweak to SmsOtpDeliveryAdapter:
 *
 *  - the request is form-encoded (userkey/passkey/to/message), not JSON, and the
 *    credentials travel in the body rather than an Authorization header;
 *  - Zenziva answers **HTTP 200 even when the send fails** and reports the real
 *    outcome in the JSON `status` field ("1" = sent). Trusting `response.ok`
 *    alone would swallow every rejected number and quota error.
 */
@Injectable()
export class ZenzivaOtpDeliveryAdapter implements OtpDeliveryPort {
  private static readonly TIMEOUT_MS = 15000;
  private readonly logger = new Logger(ZenzivaOtpDeliveryAdapter.name);

  constructor(private readonly config: AuthConfigService) {}

  async send(message: OtpMessage): Promise<void> {
    const { baseUrl, userkey, passkey } = this.config.zenziva;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ZenzivaOtpDeliveryAdapter.TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, '')}/masking/api/sendOTP/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          userkey,
          passkey,
          to: ZenzivaOtpDeliveryAdapter.toNationalFormat(message.phone),
          message: ZenzivaOtpDeliveryAdapter.compose(message),
        }).toString(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`Zenziva OTP delivery failed (HTTP ${response.status}): ${detail}`);
      throw new Error(`Zenziva OTP delivery failed with status ${response.status}`);
    }

    // Deliberately not logged with the body — the response echoes the destination number.
    const body = (await response.json().catch(() => null)) as { status?: string; text?: string } | null;
    if (!body || String(body.status) !== '1') {
      this.logger.error(`Zenziva rejected the OTP send: status=${body?.status} text=${body?.text}`);
      throw new Error(`Zenziva rejected the OTP send (status ${body?.status ?? 'unknown'})`);
    }
  }

  /**
   * Zenziva's API expects the local Indonesian form (08…); accounts are stored in
   * E.164 (+628…) by PhoneNumber. Anything not matching +62 is passed through
   * untouched so a misconfiguration surfaces at the gateway rather than silently
   * sending to a mangled number.
   */
  private static toNationalFormat(phone: string): string {
    return phone.startsWith('+62') ? `0${phone.slice(3)}` : phone;
  }

  /** Per-purpose copy. Kept well under Zenziva's 400-character ceiling. */
  private static compose(message: OtpMessage): string {
    const minutes = Math.max(1, Math.floor(message.ttlSeconds / 60));
    if (message.purpose === OtpPurpose.LOGIN) {
      return [
        'Kode Login HYDROMART',
        '',
        `Masukkan kode OTP ${message.code} untuk melanjutkan login.`,
        '',
        `Kode berlaku selama ${minutes} menit. Abaikan pesan ini jika Anda tidak melakukan permintaan login.`,
      ].join('\n');
    }
    return [
      'Kode Verifikasi HYDROMART',
      '',
      `Kode OTP Anda adalah ${message.code}.`,
      '',
      `Kode ini berlaku selama ${minutes} menit. Jangan bagikan kode ini kepada siapa pun.`,
    ].join('\n');
  }
}
