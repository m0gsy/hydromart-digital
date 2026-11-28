import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuthenticatedUser, depotScopeIds } from '@hydromart/platform';

import { ActivitySegmentPort } from '../ports/activity-segment.port';
import { CustomerDirectoryPort } from '../ports/customer-directory.port';
import { CrmConfigService } from '../../config/crm-config.service';
import {
  WA_CONSENT_TEXT_VERSION,
  WaConsentState,
  WaPurpose,
  consentState,
  generateOptInCode,
  utilityConsentForCustomer,
  WA_OPT_IN_CODE_TTL_MS,
} from '../../domain/wa-consent';
import { WA_NUMBER_1 } from '../../domain/wa-replies';
import { normalizeWaPhone } from '../../domain/wa-phone';
import { WaConsentRecord, WaConsentRepository, WaTransactionRepository } from '../ports/wa.repository';
import { CRM_TOKENS } from '../tokens';

/** The AI web (number 2) is the one peer that syncs the STOP list. */
export const WA_PEER_AIWEB = 'AIWEB';

export type ContactState = 'OPTED_IN' | 'STOPPED' | 'NONE';

/** `+62 8xx-xxxx-1234`: enough for the customer to recognise their own number, not to read it. */
export const maskWaPhone = (phone: string): string => `+${phone.slice(0, 2)} ${phone.slice(2, 3)}xx-xxxx-${phone.slice(-4)}`;

type Tx = Parameters<Parameters<WaTransactionRepository['transaction']>[0]>[0];

/**
 * HD-12/HD-13: who agreed to what on WhatsApp number 1. Codes a customer or a cashier makes, what the app
 * shows, the withdrawal, the depot CRM's contact state, and the STOP list the AI web pulls and pushes.
 */
@Injectable()
export class WhatsappConsentService {
  constructor(
    private readonly config: CrmConfigService,
    @Inject(CRM_TOKENS.WaConsentRepository) private readonly consent: WaConsentRepository,
    @Inject(CRM_TOKENS.WaTransactionRepository) private readonly tx: WaTransactionRepository,
    @Inject(CRM_TOKENS.ActivitySegment) private readonly activity: ActivitySegmentPort,
    @Inject(CRM_TOKENS.CustomerDirectory) private readonly directory: CustomerDirectoryPort,
  ) {}

  /** The chat the customer opens: number 1, prefilled with the registration text. */
  private link(code: string): string {
    return `https://wa.me/${this.config.whatsapp.number1E164.replace(/\D/g, '')}?text=${encodeURIComponent(`DAFTAR ${code}`)}`;
  }

  async createCode(input: {
    kind: 'SELF' | 'CASHIER';
    createdBy: string;
    customerId: string | null;
    depotId: string | null;
  }): Promise<{ id: string; code: string; expiresAt: Date; link: string }> {
    const created = await this.consent.createCode({
      ...input,
      code: generateOptInCode(),
      expiresAt: new Date(Date.now() + WA_OPT_IN_CODE_TTL_MS),
    });
    return { id: created.id, code: created.code, expiresAt: created.expiresAt, link: this.link(created.code) };
  }

  /** The counter screen polls this; only the cashier who made the code can see it. */
  async codeState(
    id: string,
    staffId: string,
  ): Promise<{ state: 'WAITING' | 'USED' | 'EXPIRED'; depotId: string | null }> {
    const code = await this.consent.findCodeById(id);
    if (!code || code.createdBy !== staffId) throw new NotFoundException();
    const state = code.usedAt ? 'USED' : code.expiresAt.getTime() > Date.now() ? 'WAITING' : 'EXPIRED';
    return { state, depotId: code.depotId };
  }

  async me(customerId: string): Promise<{ state: WaConsentState; phone: string | null }> {
    const { state, phone } = utilityConsentForCustomer(await this.consent.listUtilityForCustomer(customerId), customerId);
    return { state, phone: phone ? maskWaPhone(phone) : null };
  }

  /** The customer withdraws in the app: both purposes, and what is still queued for that number is cancelled. */
  async revoke(customerId: string): Promise<{ revoked: boolean }> {
    const { state, phone } = utilityConsentForCustomer(await this.consent.listUtilityForCustomer(customerId), customerId);
    if (state !== 'GRANTED' || !phone) return { revoked: false };
    await this.tx.transaction((t) => this.revokeAll(t, phone, [customerId], 'APP', `app:${randomUUID()}`));
    return { revoked: true };
  }

  /** The customer's login number changed: the old number's utility consent (and marketing) ends. */
  async revokePhone(phone: string): Promise<boolean> {
    const normalised = normalizeWaPhone(phone);
    if (!normalised) return false;
    return this.tx.transaction(async (t) => {
      const history = await t.consent.listForPhone(normalised);
      if (consentState(history, normalised, 'UTILITY') !== 'GRANTED') return false;
      await this.revokeAll(t, normalised, customerIdsOf(history), 'APP', `phone-changed:${randomUUID()}`);
      return true;
    });
  }

  /**
   * STOP, one row per purpose per customer the number was linked to (or one with no customer), in the caller's
   * transaction together with the cancellation of every queued message of that number. Giving the cap back is
   * part of it: a cancelled message was never sent.
   */
  async revokeAll(t: Tx, phone: string, customerIds: Array<string | null>, source: 'APP' | 'KEYWORD', ref: string): Promise<void> {
    const ids = customerIds.length > 0 ? customerIds : [null];
    for (const [i, customerId] of ids.entries()) {
      for (const purpose of ['UTILITY', 'MARKETING'] as const) {
        await t.consent.append(this.row(phone, customerId, purpose, false, source, `${ref}:${purpose}:${i}`, null));
      }
    }
    for (const m of await t.messages.cancelQueuedForPhone(phone)) {
      await t.caps.release(m.waNumber, m.monthKey, m.category as 'UTILITY');
    }
  }

  row(
    phone: string,
    customerId: string | null,
    purpose: WaPurpose,
    granted: boolean,
    source: string,
    sourceRef: string,
    depotId: string | null,
  ): Parameters<WaConsentRepository['append']>[0] {
    return {
      phone,
      customerId,
      waNumber: WA_NUMBER_1,
      purpose,
      legalEntity: this.config.whatsapp.legalEntityName,
      granted,
      textVersion: WA_CONSENT_TEXT_VERSION,
      source,
      sourceRef,
      depotId,
    };
  }

  /**
   * The depot CRM's follow-up list: may this customer be messaged for marketing? Asked by customer id; the
   * phone is resolved here, only for customers inside the caller's depot scope (those who ordered at one of
   * their depots). An unknown or out-of-scope id, and any failure to resolve, answers NONE: nothing else
   * leaks, and while the channel is off everything is NONE so the wa.me buttons stay hidden.
   * ponytail: the directory is read whole (same as depot campaigns); push an id filter into it if it outgrows that.
   */
  async contactStates(
    customerIds: string[],
    user: Pick<AuthenticatedUser, 'role' | 'depotId' | 'depotIds'>,
  ): Promise<Record<string, ContactState>> {
    const out: Record<string, ContactState> = Object.fromEntries(customerIds.map((id) => [id, 'NONE' as const]));
    if (!this.config.whatsapp.ready || customerIds.length === 0) return out;
    try {
      const scope = depotScopeIds(user);
      let inScope: Set<string> | null = null;
      if (scope) {
        inScope = new Set();
        for (const depotId of scope) for (const id of await this.activity.customersIn({ depotId })) inScope.add(id);
      }
      const wanted = new Set(customerIds);
      const phoneOf = new Map<string, string>();
      for (const r of await this.directory.resolveSegmentAsService({})) {
        const phone = normalizeWaPhone(r.phone);
        if (phone && wanted.has(r.customerId) && (!inScope || inScope.has(r.customerId))) phoneOf.set(r.customerId, phone);
      }
      if (phoneOf.size === 0) return out;
      const rows = await this.consent.listForPhones([...new Set(phoneOf.values())]);
      for (const [id, phone] of phoneOf) {
        const state = consentState(rows, phone, 'MARKETING');
        out[id] = state === 'GRANTED' ? 'OPTED_IN' : state === 'STOPPED' ? 'STOPPED' : 'NONE';
      }
    } catch {
      // Fail closed: no button.
      return Object.fromEntries(customerIds.map((id) => [id, 'NONE' as const]));
    }
    return out;
  }

  /**
   * The STOP list for the AI web. CONTRACT for the puller: `seq` is not commit-ordered, so re-read an overlap
   * window (after = cursor - 1000) on every call and dedupe on `id`. Each good call stamps the peer clock.
   */
  async optOutsAfter(after: number, limit: number): Promise<{ items: OptOutItem[]; nextAfter: number }> {
    const rows = await this.consent.listAfter(BigInt(after), limit);
    const items = rows.map(toItem);
    const last = rows.length > 0 ? rows[rows.length - 1].seq : BigInt(after);
    await this.consent.stampPeer(WA_PEER_AIWEB, new Date(), last);
    return { items, nextAfter: Number(last) };
  }

  /** The AI web's own STOP/MULAI on number 2: MARKETING only, idempotent on its event id. */
  async acceptOptOuts(
    items: Array<{ eventId: string; phone: string; granted: boolean; recordedAt: string }>,
  ): Promise<{ accepted: number; duplicates: number }> {
    const rows = items.map((item) => {
      const phone = normalizeWaPhone(item.phone);
      if (!phone) throw new BadRequestException('phone is not an Indonesian mobile number');
      // The customer's own time, never in the future: it orders their choices across both numbers.
      const at = new Date(Math.min(new Date(item.recordedAt).getTime(), Date.now()));
      return {
        ...this.row(phone, null, 'MARKETING', item.granted, 'AIWEB', item.eventId, null),
        waNumber: '2',
        recordedAt: at,
      };
    });
    let accepted = 0;
    for (const row of rows) if (await this.consent.append(row)) accepted += 1;
    return { accepted, duplicates: rows.length - accepted };
  }
}

export interface OptOutItem {
  id: string;
  seq: number;
  phone: string;
  purpose: string;
  granted: boolean;
  source: string;
  recordedAt: Date;
}

const toItem = (r: WaConsentRecord): OptOutItem => ({
  id: r.id,
  seq: Number(r.seq),
  phone: r.phone,
  purpose: r.purpose,
  granted: r.granted,
  source: r.source,
  recordedAt: r.recordedAt,
});

/** The customers a number was ever linked to: a STOP must reach each of them, not only the newest. */
export const customerIdsOf = (rows: readonly WaConsentRecord[]): string[] => [
  ...new Set(rows.map((r) => r.customerId).filter((id): id is string => id !== null)),
];
