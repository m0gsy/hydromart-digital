import { Injectable, Logger } from '@nestjs/common';

import { OtpDeliveryPort, OtpMessage } from '../../application/ports/otp-delivery.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * Delivers OTP codes via the WhatsApp Business (Cloud API) using a pre-approved
 * template message. Selected via OTP_DELIVERY_CHANNEL=whatsapp (PRD §19,
 * Notification Matrix: OTP is a WhatsApp-only channel).
 */
@Injectable()
export class WhatsappOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly logger = new Logger(WhatsappOtpDeliveryAdapter.name);

  constructor(private readonly config: AuthConfigService) {}

  async send(message: OtpMessage): Promise<void> {
    const { baseUrl, token, template } = this.config.whatsapp;
    // WhatsApp Cloud API expects the recipient without the leading '+'.
    const to = message.phone.replace(/^\+/, '');

    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: 'id' },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: message.code }],
            },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: message.code }],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`WhatsApp OTP delivery failed (${response.status}): ${detail}`);
      throw new Error(`WhatsApp OTP delivery failed with status ${response.status}`);
    }
  }
}
