import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';

import { localMonthKey } from '@hydromart/platform';

import { CrmConfigService } from '../../config/crm-config.service';
import { consentState, utilityConsentForCustomer } from '../../domain/wa-consent';
import { WaCategory } from '../../domain/wa-cost';
import { NotificationEvent } from '../../domain/notification-event';
import { WA_NUMBER_1, buildTemplateParams } from '../../domain/wa-replies';
import { WA_TEMPLATE_SPECS, WaUtilityEvent, isWaUtilityEvent } from '../../domain/wa-templates';
import {
  WaCapRepository,
  WaConsentRepository,
  WaMessageRecord,
  WaMessageRepository,
  WaTemplateRepository,
} from '../ports/wa.repository';
import { WhatsappEnqueuePort } from '../ports/whatsapp-enqueue.port';
import { WhatsappSenderPort } from '../ports/whatsapp-sender.port';
import { CRM_TOKENS } from '../tokens';
import { NotificationService } from './notification.service';
import { WhatsappConsentService } from './whatsapp-consent.service';

/** A template message Meta did not take for a passing reason is retried by the sweep this often, then given up. */
const MAX_ATTEMPTS = 3;
const RETRY_WINDOW_MS = 15 * 60 * 1000;
const CLAIM_STALE_MS = 2 * 60 * 1000;
const SWEEP_BATCH = 50;

export type DeliverOutcome = 'SENT' | 'RETRY' | 'FAILED' | 'CANCELLED';

const specByName = (name: string) => Object.values(WA_TEMPLATE_SPECS).find((s) => s.name === name);

/**
 * HD-12: the send path of WhatsApp number 1. WhatsApp is ADDITIVE: the inbox row and the push were filed before
 * `enqueue` runs, and a refused or failed WhatsApp leaves a `wa_messages` row with the reason, never a lost
 * notification. While WA_ENABLED is blank this writes nothing and calls nobody.
 */
@Injectable()
export class WhatsappService implements WhatsappEnqueuePort {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly config: CrmConfigService,
    @Inject(CRM_TOKENS.WaConsentRepository) private readonly consent: WaConsentRepository,
    @Inject(CRM_TOKENS.WaMessageRepository) private readonly messages: WaMessageRepository,
    @Inject(CRM_TOKENS.WaCapRepository) private readonly caps: WaCapRepository,
    @Inject(CRM_TOKENS.WaTemplateRepository) private readonly templates: WaTemplateRepository,
    @Inject(CRM_TOKENS.WhatsappSender) private readonly sender: WhatsappSenderPort,
    private readonly consentService: WhatsappConsentService,
    // NotificationService calls this service, so it is looked up on use, not injected (no cycle).
    private readonly moduleRef: ModuleRef,
  ) {}

  async enqueue(input: {
    event: string;
    customerId: string;
    notificationId: string;
    dedupeKey: string | null;
    vars: Record<string, string>;
  }): Promise<void> {
    if (!this.config.whatsapp.enabled || !isWaUtilityEvent(input.event)) return;
    try {
      await this.enqueueChecked(input, input.event);
    } catch (e) {
      this.logger.warn(`WhatsApp enqueue for ${input.event} failed: ${(e as Error).name}`);
    }
  }

  async phoneChanged(oldPhone: string): Promise<void> {
    // Ledger work only (nothing leaves), so it runs whether or not the channel is on.
    try {
      await this.consentService.revokePhone(oldPhone);
    } catch (e) {
      this.logger.warn(`WhatsApp consent of a changed number could not be ended: ${(e as Error).name}`);
    }
  }

  private async enqueueChecked(
    input: { customerId: string; notificationId: string; dedupeKey: string | null; vars: Record<string, string> },
    event: WaUtilityEvent,
  ): Promise<void> {
    const spec = WA_TEMPLATE_SPECS[event];
    const base = {
      notificationId: input.notificationId,
      dedupeKey: `wa:${input.dedupeKey ?? input.notificationId}`,
      customerId: input.customerId,
      waNumber: WA_NUMBER_1,
      category: 'UTILITY' as const,
      templateName: spec.name,
      language: spec.language,
      monthKey: localMonthKey(new Date()),
    };
    const skip = async (phone: string, reason: string): Promise<void> => {
      await this.messages.insertIfNew({ ...base, phone, vars: {}, status: 'SKIPPED', skipReason: reason });
    };

    if (!this.config.whatsapp.ready) return skip('', 'OFF');
    const cap = await this.caps.getCap(WA_NUMBER_1, 'UTILITY');
    if (!cap) return skip('', 'CAP');
    if (cap.paused) return skip('', 'PAUSED');
    const state = utilityConsentForCustomer(
      await this.consent.listUtilityForCustomer(input.customerId),
      input.customerId,
    );
    // Never asked has no number at all; a row with a blank number cannot be messaged.
    if (!state.phone) return skip('', state.state === 'NONE' ? 'NO_CONSENT' : 'NO_PHONE');
    if (state.state === 'STOPPED') return skip(state.phone, 'STOPPED');
    const template = await this.templates.get(spec.name, spec.language);
    if (!template || template.status !== 'APPROVED') return skip(state.phone, 'TEMPLATE_NOT_APPROVED');
    // An empty parameter is refused by Meta: caught here, before the cap is reserved.
    const params = buildTemplateParams(spec.params, input.vars);
    if (!params) return skip(state.phone, 'MISSING_PARAM');

    const vars = Object.fromEntries(spec.params.map((key, i) => [key, params[i]]));
    const inserted = await this.messages.insertIfNew({
      ...base,
      phone: state.phone,
      vars,
      status: 'QUEUED',
      skipReason: null,
    });
    if (!inserted) return; // a retried event: already queued or sent
    const row = await this.messages.findByDedupeKey(base.dedupeKey);
    if (row && (await this.reserve(row, 'UTILITY', cap.monthlyMessages))) await this.deliver(row);
  }

  /** Counts the message against the month; a refusal keeps the row with its reason. True = go ahead. */
  private async reserve(row: WaMessageRecord, category: WaCategory, monthlyMessages: number): Promise<boolean> {
    const result = await this.caps.reserve(row.waNumber, row.monthKey, category);
    if (!result.ok) {
      await this.messages.markSkipped(row.id, result.reason);
      return false;
    }
    const cap = monthlyMessages;
    const shared = { category, used: String(result.messages), cap: String(cap) };
    if (result.warn && (await this.caps.markWarned(row.waNumber, row.monthKey, category, new Date()))) {
      const pct = String(Math.min(100, Math.round((result.messages * 100) / cap)));
      await this.alert(NotificationEvent.WA_CAP_WARNING, row, { ...shared, pct });
    }
    if (result.reachesCap && (await this.caps.markStopped(row.waNumber, row.monthKey, category, new Date()))) {
      await this.alert(NotificationEvent.WA_CAP_REACHED, row, { ...shared, pct: '100' });
    }
    return true;
  }

  private async alert(event: NotificationEvent, row: WaMessageRecord, vars: Record<string, string>): Promise<void> {
    try {
      await this.moduleRef
        .get(NotificationService, { strict: false })
        .notify(event, '', vars, null, null, `${event}:${row.waNumber}:${row.monthKey}:${vars.category}`);
    } catch (e) {
      this.logger.warn(`${event} could not be filed: ${(e as Error).message}`);
    }
  }

  private release(row: WaMessageRecord): Promise<void> {
    return this.caps.release(row.waNumber, row.monthKey, row.category as WaCategory);
  }

  /** The last step: re-read consent (a STOP may have landed since), then hand the message to Meta. */
  async deliver(row: WaMessageRecord): Promise<DeliverOutcome> {
    const now = new Date();
    if (consentState(await this.consent.listForPhone(row.phone), row.phone, 'UTILITY') !== 'GRANTED') {
      if (await this.messages.markCancelled(row.id)) await this.release(row);
      return 'CANCELLED';
    }
    const spec = specByName(row.templateName);
    const params = spec ? spec.params.map((key) => row.vars[key] ?? '') : [];
    if (!spec || params.some((p) => !p)) {
      await this.messages.markFailed(row.id, 'BAD_TEMPLATE', 'Template or its parameters are not known here', now);
      await this.release(row);
      return 'FAILED';
    }
    const sent = await this.sender.sendTemplate({ to: row.phone, name: spec.name, language: spec.language, params });
    if (sent.ok) {
      await this.messages.markSent(row.id, sent.messageId, now);
      return 'SENT';
    }
    const exhausted =
      sent.permanent || row.attempts + 1 >= MAX_ATTEMPTS || now.getTime() - row.createdAt.getTime() > RETRY_WINDOW_MS;
    if (!exhausted) {
      await this.messages.markRetry(row.id);
      return 'RETRY';
    }
    // Meta did not accept it: the slot goes back.
    await this.messages.markFailed(row.id, sent.code, sent.error, now);
    await this.release(row);
    return 'FAILED';
  }

  /** The retry sweep: claims the QUEUED rows nobody is sending and delivers them. */
  async processQueue(): Promise<{ claimed: number } & Record<Lowercase<DeliverOutcome>, number>> {
    const now = new Date();
    const rows = await this.messages.claimQueued(
      SWEEP_BATCH,
      randomUUID(),
      now,
      new Date(now.getTime() - CLAIM_STALE_MS),
    );
    const tally = { claimed: rows.length, sent: 0, retry: 0, failed: 0, cancelled: 0 };
    for (const row of rows) {
      try {
        tally[(await this.deliver(row)).toLowerCase() as Lowercase<DeliverOutcome>] += 1;
      } catch (e) {
        this.logger.warn(`WhatsApp delivery of ${row.id} failed: ${(e as Error).name}`);
      }
    }
    return tally;
  }

  /**
   * A free-text reply inside the customer's own service window (the webhook answering what they just wrote).
   * Counted at rate 0, never retried: the window it needs is the one the customer just opened.
   */
  async sendService(phone: string, body: string, key: string): Promise<void> {
    try {
      const dedupeKey = `wa:svc:${key}`;
      const inserted = await this.messages.insertIfNew({
        notificationId: null,
        dedupeKey,
        customerId: null,
        phone,
        waNumber: WA_NUMBER_1,
        category: 'SERVICE',
        templateName: 'service_text',
        language: 'id',
        vars: {},
        status: 'QUEUED',
        skipReason: null,
        monthKey: localMonthKey(new Date()),
      });
      const row = inserted ? await this.messages.findByDedupeKey(dedupeKey) : null;
      if (!row) return;
      const cap = await this.caps.getCap(WA_NUMBER_1, 'SERVICE');
      if (!cap) return this.messages.markSkipped(row.id, 'CAP');
      if (!(await this.reserve(row, 'SERVICE', cap.monthlyMessages))) return;
      const sent = await this.sender.sendText({ to: phone, body });
      if (sent.ok) {
        await this.messages.markSent(row.id, sent.messageId, new Date());
        return;
      }
      await this.messages.markFailed(row.id, sent.code, sent.error, new Date());
      await this.release(row);
    } catch (e) {
      this.logger.warn(`WhatsApp service reply failed: ${(e as Error).name}`);
    }
  }
}
