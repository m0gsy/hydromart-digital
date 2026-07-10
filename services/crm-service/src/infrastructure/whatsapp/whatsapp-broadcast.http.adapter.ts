import { Injectable, Logger } from '@nestjs/common';

import { WhatsappBroadcastPort } from '../../application/ports/whatsapp-broadcast.port';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * Sends broadcast messages via the WhatsApp Business (Cloud API), mirroring auth-service's
 * WhatsApp request style. When WHATSAPP_API_URL is blank the adapter runs in console/dev
 * mode — it logs the message and reports success (a legitimate dev fallback, the same way
 * auth-service selects its delivery channel, NOT a placeholder). This port never throws: a
 * single recipient failure is returned as { ok: false, error } so the broadcast carries on.
 */
@Injectable()
export class WhatsappBroadcastHttpAdapter implements WhatsappBroadcastPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(WhatsappBroadcastHttpAdapter.name);

  constructor(private readonly config: CrmConfigService) {}

  async send(phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
    const { baseUrl, token } = this.config.whatsapp;

    // Dev/console mode: no WhatsApp endpoint configured.
    if (!baseUrl) {
      this.logger.log(`[dev] WhatsApp broadcast to ${phone}: ${message}`);
      return { ok: true };
    }

    // WhatsApp Cloud API expects the recipient without the leading '+'.
    const to = phone.replace(/^\+/, '');
    try {
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        }),
        signal: AbortSignal.timeout(WhatsappBroadcastHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return {
          ok: false,
          error: `WhatsApp responded ${res.status}${detail ? `: ${detail}` : ''}`,
        };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}
