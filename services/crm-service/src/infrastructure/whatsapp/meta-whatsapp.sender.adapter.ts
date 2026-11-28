import { Injectable, Logger } from '@nestjs/common';

import { WaSendResult, WhatsappSenderPort } from '../../application/ports/whatsapp-sender.port';
import { CrmConfigService } from '../../config/crm-config.service';
import { WA_RETRYABLE_CODES } from '../../domain/wa-replies';

const TIMEOUT_MS = 10_000;

/**
 * Meta WhatsApp Cloud API, number 1. Only ever called by the send path after it checked the channel is
 * ready. The access token goes in the Authorization header and nowhere else: not in a URL, not in a log
 * line, and an error text carries Meta's code and title, never the request.
 */
@Injectable()
export class MetaWhatsappSenderAdapter implements WhatsappSenderPort {
  private readonly logger = new Logger(MetaWhatsappSenderAdapter.name);

  constructor(private readonly config: CrmConfigService) {}

  sendTemplate(input: { to: string; name: string; language: string; params: string[] }): Promise<WaSendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'template',
      template: {
        name: input.name,
        language: { code: input.language },
        components: [{ type: 'body', parameters: input.params.map((text) => ({ type: 'text', text })) }],
      },
    });
  }

  sendText(input: { to: string; body: string }): Promise<WaSendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'text',
      text: { body: input.body, preview_url: false },
    });
  }

  private async post(payload: unknown): Promise<WaSendResult> {
    const wa = this.config.whatsapp;
    try {
      const res = await fetch(`https://graph.facebook.com/${wa.graphVersion}/${wa.phoneNumberId1}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wa.accessToken}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { code?: number; message?: string };
      };
      const messageId = body.messages?.[0]?.id;
      if (res.ok && messageId) return { ok: true, messageId };
      const code = body.error?.code === undefined ? null : String(body.error.code);
      // A throttle or an outage is worth another try; any other 4xx is Meta saying this message can never go.
      const transient = res.status === 429 || res.status >= 500 || (code !== null && WA_RETRYABLE_CODES.has(code));
      this.logger.warn(`Meta refused a message: HTTP ${res.status}, code ${code ?? '-'}`);
      return { ok: false, permanent: !transient, code, error: `HTTP ${res.status}${code ? ` code ${code}` : ''}`.slice(0, 200) };
    } catch (e) {
      const timeout = ['TimeoutError', 'AbortError'].includes((e as Error).name);
      this.logger.warn(`Meta call failed: ${timeout ? 'timeout' : (e as Error).name}`);
      return { ok: false, permanent: false, code: null, error: timeout ? 'timeout' : 'network' };
    }
  }
}
