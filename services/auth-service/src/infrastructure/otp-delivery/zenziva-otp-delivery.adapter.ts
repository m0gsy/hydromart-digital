import { Injectable, Logger } from '@nestjs/common';

import { redactGatewayDetail } from './redact-gateway-detail';

import { OtpPurpose } from '../../domain/otp/otp-purpose.enum';
import { OtpDeliveryPort, OtpMessage } from '../../application/ports/otp-delivery.port';
import { AuthConfigService } from '../../config/auth-config.service';
import {
  OtpGatewayRejectedError,
  OtpGatewayUnreachableError,
} from '../../application/ports/otp-delivery.port';

/** Response fields that may carry Zenziva's own reference for a message (names only; see send()). */
const REF_KEYS = ['messageId', 'message_id', 'id', 'trxid', 'trx_id', 'reference'];

/**
 * A value safe to put in a log line as a message reference: identifier-shaped, and not a run of
 * 9-14 digits, which is the shape of a phone number and the one thing that must never be logged.
 */
const isReference = (v: unknown): boolean =>
  (typeof v === 'string' || typeof v === 'number') &&
  /^[\w-]{3,64}$/.test(String(v)) &&
  !/^\d{9,14}$/.test(String(v));

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
  /*
   * 8 seconds, and the number is chosen against the CALLER's deadline rather than picked.
   *
   * This was 15000 — exactly the web client's own `TIMEOUT_MS`. Two equal deadlines mean
   * the browser gives up in the same second the server is still waiting, so the user read
   * "Server terlalu lama menjawab" while the SMS was on its way: a login that looked
   * broken, could not be retried for the 60-second resend cooldown, and worked after a
   * refresh with the code that had already arrived.
   *
   * An inner deadline has to be comfortably shorter than the outer one or the outer one
   * always wins. 8s leaves the request room to answer — with a real error if Zenziva is
   * slow — before the browser stops listening.
   */
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(ZenzivaOtpDeliveryAdapter.name);

  constructor(private readonly config: AuthConfigService) {}

  async send(message: OtpMessage): Promise<void> {
    const { baseUrl, userkey, passkey } = this.config.zenziva;

    const startedAt = Date.now();
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
    } catch (error) {
      /*
       * Aborted or unreachable: the send may well have happened anyway. Zenziva can
       * accept the message and answer slowly, so "we stopped waiting" is not "it failed"
       * — and the caller has to be able to tell those apart before it decides whether to
       * throw away a challenge whose code is possibly already on the customer's phone.
       */
      throw new OtpGatewayUnreachableError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // AUTH-6: Zenziva echoes the message it was asked to send, and the message IS the code.
      const detail = redactGatewayDetail(await response.text().catch(() => ''), {
        code: message.code,
        phone: message.phone,
      });
      this.logger.error(`Zenziva OTP delivery failed (HTTP ${response.status}): ${detail}`);
      throw new OtpGatewayRejectedError(`Zenziva answered HTTP ${response.status}`);
    }

    // Deliberately not logged with the body — the response echoes the destination number.
    const body = (await response.json().catch(() => null)) as {
      status?: string;
      text?: string;
    } | null;
    if (!body || String(body.status) !== '1') {
      this.logger.error(
        `Zenziva rejected the OTP send: status=${body?.status} text=${redactGatewayDetail(
          String(body?.text ?? ''),
          { code: message.code, phone: message.phone },
        )}`,
      );
      throw new OtpGatewayRejectedError(`Zenziva status ${body?.status ?? 'unknown'}`);
    }

    /*
     * The success path used to be silent, so "the code took minutes" could not be told apart from
     * "we handed it to Zenziva minutes late": only a failure left a trace, and a slow success left
     * none. This is the one line that separates OUR side from the SMS network's — how long Zenziva
     * took to accept the message, and the reference it gave us, which is what its support asks for
     * when a delivery is late.
     *
     * Never the body: it echoes the destination number and the message, and the message IS the
     * code. Only the response's field NAMES are logged (so the reference field can be identified
     * from a real send), plus one reference value when it has the shape of an identifier.
     */
    const ref = REF_KEYS.map((key) => (body as Record<string, unknown>)[key]).find(isReference);
    this.logger.log(
      `Zenziva accepted the OTP send in ${Date.now() - startedAt}ms ` +
        `(response fields: ${Object.keys(body).join(',')}${ref === undefined ? '' : `; ref=${String(ref)}`})`,
    );
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
