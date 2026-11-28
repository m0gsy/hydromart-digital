import { Inject, Injectable, Logger } from '@nestjs/common';

import { CrmConfigService } from '../../config/crm-config.service';
import { WA_CONSENT_TEXT_VERSION, WaKeyword, consentState, parseKeyword } from '../../domain/wa-consent';
import { normalizeWaPhone } from '../../domain/wa-phone';
import {
  WA_AUTO_REPLY_GAP_MS,
  WA_NUMBER_1,
  WA_REPLY_CODE_INVALID,
  WA_REPLY_OTHER,
  WA_REPLY_PROMO,
  WA_REPLY_STARTED,
  WA_REPLY_STOPPED,
  waRegisteredReply,
} from '../../domain/wa-replies';
import { WaTransactionRepository, WaTemplateRepository } from '../ports/wa.repository';
import { CRM_TOKENS } from '../tokens';
import { WhatsappConsentService, customerIdsOf } from './whatsapp-consent.service';
import { WhatsappService } from './whatsapp.service';

type Tx = Parameters<Parameters<WaTransactionRepository['transaction']>[0]>[0];
type Obj = Record<string, unknown>;

const obj = (x: unknown): Obj => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

const STATUS = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' } as const;
const TEMPLATE_STATUS: Record<string, string> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAUSED: 'PAUSED',
  DISABLED: 'PAUSED',
  PENDING: 'SUBMITTED',
  IN_APPEAL: 'SUBMITTED',
};

/**
 * HD-12/HD-13: what Meta tells us. Every item runs in ONE transaction together with its dedupe key, so a
 * processing error takes the key back with it and Meta's retry processes the item again, while a repeat of a
 * finished item changes nothing. Unknown shapes are logged (no content) and answered 200, never a 5xx loop.
 */
@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);

  constructor(
    private readonly config: CrmConfigService,
    private readonly consent: WhatsappConsentService,
    private readonly whatsapp: WhatsappService,
    @Inject(CRM_TOKENS.WaTransactionRepository) private readonly tx: WaTransactionRepository,
    @Inject(CRM_TOKENS.WaTemplateRepository) private readonly templates: WaTemplateRepository,
  ) {}

  async handle(payload: unknown): Promise<void> {
    const wa = this.config.whatsapp;
    for (const entry of arr(obj(payload).entry).map(obj)) {
      // Another WABA's traffic is not ours to act on.
      if (str(entry.id) !== wa.wabaId1) {
        this.logger.warn('WhatsApp webhook entry for another account ignored');
        continue;
      }
      for (const change of arr(entry.changes).map(obj)) {
        const value = obj(change.value);
        if (change.field === 'message_template_status_update') {
          await this.templateUpdate(value);
        } else if (change.field === 'messages' && str(obj(value.metadata).phone_number_id) === wa.phoneNumberId1) {
          for (const message of arr(value.messages).map(obj)) await this.inboundMessage(message);
          for (const status of arr(value.statuses).map(obj)) await this.statusUpdate(status);
        } else {
          this.logger.warn(`WhatsApp webhook change "${str(change.field).slice(0, 40)}" not handled`);
        }
      }
    }
  }

  private async inboundMessage(message: Obj): Promise<void> {
    const wamid = str(message.id);
    const phone = normalizeWaPhone(str(message.from));
    if (!wamid || !phone) {
      this.logger.warn('WhatsApp inbound message without a usable id or sender ignored');
      return;
    }
    const text = message.type === 'text' ? str(obj(message.text).body) : '';
    const reply = await this.tx.transaction(async (t) =>
      (await t.messages.recordInbound(wamid, 'MESSAGE')) ? this.decide(t, phone, wamid, parseKeyword(text)) : null,
    );
    // Outside the transaction: a reply Meta refuses must not undo the consent that was just recorded.
    if (reply) await this.whatsapp.sendService(phone, reply, wamid);
  }

  /** What the message does to the ledger, and what to answer (null = nothing). */
  private async decide(t: Tx, phone: string, wamid: string, keyword: WaKeyword): Promise<string | null> {
    const history = await t.consent.listForPhone(phone);
    const linked = customerIdsOf(history);
    const latest = [...history].reverse().find((r) => r.customerId !== null)?.customerId ?? null;
    switch (keyword.kind) {
      case 'REGISTER': {
        const code = await t.consent.claimCode(keyword.code, phone, new Date());
        if (!code) return WA_REPLY_CODE_INVALID;
        await t.consent.append({
          ...this.consent.row(phone, code.customerId, 'UTILITY', true, code.kind === 'SELF' ? 'APP' : 'CASHIER_QR', code.id, code.depotId),
          textVersion: WA_CONSENT_TEXT_VERSION,
        });
        return waRegisteredReply(this.config.whatsapp.legalEntityName);
      }
      case 'STOP':
        await this.consent.revokeAll(t, phone, linked, 'KEYWORD', wamid);
        return WA_REPLY_STOPPED;
      case 'START':
        // A number that never opted in cannot opt in by typing MULAI: it needs a code.
        if (history.some((r) => r.purpose === 'UTILITY' && r.waNumber === WA_NUMBER_1 && r.granted)) {
          await t.consent.append(this.consent.row(phone, latest, 'UTILITY', true, 'KEYWORD', `${wamid}:UTILITY`, null));
          return WA_REPLY_STARTED;
        }
        return this.other(t, phone);
      case 'PROMO':
        if (consentState(history, phone, 'UTILITY') === 'GRANTED') {
          await t.consent.append(this.consent.row(phone, latest, 'MARKETING', true, 'KEYWORD', `${wamid}:MARKETING`, null));
          return WA_REPLY_PROMO;
        }
        return this.other(t, phone);
      default:
        return this.other(t, phone);
    }
  }

  /** One automatic reply per phone per 24 hours. */
  private async other(t: Tx, phone: string): Promise<string | null> {
    const last = await t.messages.lastServiceReplyAt(phone);
    return last && Date.now() - last.getTime() < WA_AUTO_REPLY_GAP_MS ? null : WA_REPLY_OTHER;
  }

  private async statusUpdate(item: Obj): Promise<void> {
    const wamid = str(item.id);
    const reported = STATUS[str(item.status) as keyof typeof STATUS];
    if (!wamid || !reported) {
      this.logger.warn('WhatsApp status without a usable id or state ignored');
      return;
    }
    const errors = arr(item.errors).map(obj);
    const status = errors.length > 0 ? 'FAILED' : reported;
    const seconds = Number(item.timestamp);
    const at = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
    await this.tx.transaction(async (t) => {
      if (!(await t.messages.recordInbound(`${wamid}:${reported.toLowerCase()}`, 'STATUS'))) return;
      const error =
        status === 'FAILED'
          ? { code: errors[0] ? String(errors[0].code ?? '') || null : null, text: str(errors[0]?.title) || 'failed' }
          : null;
      const applied = await t.messages.applyStatus(wamid, status, at, error);
      // The report beat our own markSent (the wamid is not stored yet): roll the dedupe key back and let
      // Meta's retry apply it, instead of losing it.
      if (!applied) throw new Error('status for a message not stored yet');
      // Meta did not bill it, or it failed: the upper-bound reservation goes back, once per message.
      const give = obj(item.pricing).billable === false || (status === 'FAILED' && applied.changed);
      if (give && (await t.messages.recordInbound(`${wamid}:release`, 'RELEASE'))) {
        await t.caps.release(applied.record.waNumber, applied.record.monthKey, applied.record.category as 'UTILITY');
      }
    });
  }

  private async templateUpdate(value: Obj): Promise<void> {
    const status = TEMPLATE_STATUS[str(value.event).toUpperCase()];
    const name = str(value.message_template_name);
    const language = str(value.message_template_language);
    if (status && name && language) {
      await this.templates.setStatus(name, language, status, str(value.reason).slice(0, 200) || null);
    }
  }
}
