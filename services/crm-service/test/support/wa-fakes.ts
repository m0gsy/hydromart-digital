import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import {
  WaCapRecord,
  WaCapRepository,
  WaConsentInput,
  WaConsentRecord,
  WaConsentRepository,
  WaCounterRecord,
  WaMessageInput,
  WaMessageRecord,
  WaMessageRepository,
  WaOptInCodeRecord,
  WaReserveResult,
  WaTemplateRecord,
  WaTemplateRepository,
  WaTransactionRepository,
} from '../../src/application/ports/wa.repository';
import { WaSendResult, WhatsappSenderPort } from '../../src/application/ports/whatsapp-sender.port';
import { CrmConfigService } from '../../src/config/crm-config.service';
import { WaCapLimits, WaCategory, rateFor, reservation, warnThreshold } from '../../src/domain/wa-cost';

export const WA_ENV: Record<string, string> = {
  WA_ENABLED: 'true',
  WA_ACCESS_TOKEN: 'tok-secret',
  WA_APP_SECRET: 's3cr3t-app-secret',
  WA_VERIFY_TOKEN: 'verify-me',
  WA_PHONE_NUMBER_ID_1: '1111',
  WA_WABA_ID_1: '2222',
  WA_GRAPH_VERSION: 'v21.0',
  WA_NUMBER_1_E164: '+6281100000000',
  WA_LEGAL_ENTITY_NAME: 'PT Contoh',
};

export const waConfig = (env: Record<string, string> = WA_ENV): CrmConfigService =>
  new CrmConfigService(new ConfigService(env));

export class FakeConsent implements WaConsentRepository {
  rows: WaConsentRecord[] = [];
  codes: WaOptInCodeRecord[] = [];
  peer: { lastOkAt: Date; lastSeq: bigint } | null = null;
  private seq = 0n;

  async append(input: WaConsentInput): Promise<boolean> {
    if (input.sourceRef && this.rows.some((r) => r.source === input.source && r.sourceRef === input.sourceRef)) {
      return false;
    }
    this.rows.push({
      ...input,
      recordedAt: input.recordedAt ?? new Date(Date.UTC(2026, 10, 29) + Number(this.seq) * 1000),
      id: randomUUID(),
      seq: (this.seq += 1n),
      channel: 'WHATSAPP',
    });
    return true;
  }
  async listForPhone(phone: string): Promise<WaConsentRecord[]> {
    return this.rows.filter((r) => r.phone === phone);
  }
  async listForPhones(phones: string[]): Promise<WaConsentRecord[]> {
    return this.rows.filter((r) => phones.includes(r.phone));
  }
  async listUtilityForCustomer(customerId: string): Promise<WaConsentRecord[]> {
    return this.rows.filter((r) => r.customerId === customerId && r.purpose === 'UTILITY' && r.waNumber === '1');
  }
  async listAfter(afterSeq: bigint, limit: number): Promise<WaConsentRecord[]> {
    return this.rows.filter((r) => r.seq > afterSeq && r.purpose === 'MARKETING' && r.source !== 'AIWEB').slice(0, limit);
  }
  async createCode(input: {
    code: string;
    kind: string;
    customerId: string | null;
    depotId: string | null;
    createdBy: string;
    expiresAt: Date;
  }): Promise<WaOptInCodeRecord> {
    const row = { ...input, id: randomUUID(), usedAt: null, usedPhone: null };
    this.codes.push(row);
    return row;
  }
  async findCode(code: string): Promise<WaOptInCodeRecord | null> {
    return this.codes.find((c) => c.code === code) ?? null;
  }
  async findCodeById(id: string): Promise<WaOptInCodeRecord | null> {
    return this.codes.find((c) => c.id === id) ?? null;
  }
  async claimCode(code: string, phone: string, now: Date): Promise<WaOptInCodeRecord | null> {
    const found = this.codes.find((c) => c.code === code && !c.usedAt && c.expiresAt > now);
    if (!found) return null;
    found.usedAt = now;
    found.usedPhone = phone;
    return found;
  }
  async peerLastOkAt(): Promise<Date | null> {
    return this.peer ? this.peer.lastOkAt : null;
  }
  async stampPeer(_peer: string, now: Date, lastSeq: bigint): Promise<void> {
    this.peer = { lastOkAt: now, lastSeq };
  }
  async purgeBefore(): Promise<number> {
    return 0;
  }
}

export class FakeMessages implements WaMessageRepository {
  rows: Array<WaMessageRecord & { customerId: string | null; errorCode?: string | null }> = [];
  inbound = new Set<string>();
  /** Makes recordInbound throw once, to prove a processing error rolls the dedupe key back. */
  failAfterRecord = false;

  async insertIfNew(input: WaMessageInput): Promise<boolean> {
    if (this.rows.some((r) => r.dedupeKey === input.dedupeKey)) return false;
    this.rows.push({
      ...input,
      id: randomUUID(),
      metaMessageId: null,
      attempts: 0,
      createdAt: new Date(Date.now() - 60_000),
    });
    return true;
  }
  async findByDedupeKey(key: string): Promise<WaMessageRecord | null> {
    return this.rows.find((r) => r.dedupeKey === key) ?? null;
  }
  private row(id: string) {
    return this.rows.find((r) => r.id === id)!;
  }
  async markSent(id: string, meta: string, _at?: Date): Promise<void> {
    Object.assign(this.row(id), { status: 'SENT', metaMessageId: meta, attempts: this.row(id).attempts + 1 });
  }
  async markRetry(id: string): Promise<void> {
    this.row(id).attempts += 1;
  }
  async markFailed(id: string, code: string | null): Promise<void> {
    Object.assign(this.row(id), { status: 'FAILED', errorCode: code });
  }
  async markSkipped(id: string, reason: string): Promise<void> {
    Object.assign(this.row(id), { status: 'SKIPPED', skipReason: reason });
  }
  async markCancelled(id: string): Promise<boolean> {
    const r = this.row(id);
    if (r.status !== 'QUEUED') return false;
    r.status = 'CANCELLED';
    return true;
  }
  async cancelQueuedForPhone(phone: string): Promise<WaMessageRecord[]> {
    const hit = this.rows.filter((r) => r.phone === phone && r.status === 'QUEUED');
    hit.forEach((r) => (r.status = 'CANCELLED'));
    return hit;
  }
  async claimQueued(limit: number): Promise<WaMessageRecord[]> {
    return this.rows.filter((r) => r.status === 'QUEUED' && r.category !== 'SERVICE').slice(0, limit);
  }
  async recordInbound(key: string): Promise<boolean> {
    if (this.inbound.has(key)) return false;
    this.inbound.add(key);
    return true;
  }
  async applyStatus(
    meta: string,
    status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
  ): Promise<{ record: WaMessageRecord; changed: boolean } | null> {
    const r = this.rows.find((x) => x.metaMessageId === meta);
    if (!r) return null;
    const rank: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };
    const ok = status === 'FAILED' ? (rank[r.status] ?? 9) <= 1 : (rank[r.status] ?? 9) < rank[status];
    if (ok) r.status = status;
    return { record: r, changed: ok };
  }
  async lastServiceReplyAt(phone: string): Promise<Date | null> {
    const hit = this.rows.filter((r) => r.phone === phone && r.category === 'SERVICE');
    return hit.length ? hit[hit.length - 1].createdAt : null;
  }
  async listProblems(): Promise<WaMessageRecord[]> {
    return this.rows.filter((r) => r.status === 'FAILED' || (r.status === 'SKIPPED' && r.skipReason !== 'NO_CONSENT'));
  }
  async purgeMessagesBefore(): Promise<number> {
    return 3;
  }
  async purgeInboundBefore(): Promise<number> {
    return 4;
  }
}

export class FakeCaps implements WaCapRepository {
  caps = new Map<string, WaCapRecord>();
  counters = new Map<string, WaCounterRecord>();
  releases: string[] = [];
  private key = (n: string, m: string, c: string) => `${n}|${m}|${c}`;

  setCap(category: string, limits: Partial<WaCapLimits> & { monthlyMessages: number }, waNumber = '1'): void {
    this.caps.set(`${waNumber}|${category}`, {
      waNumber,
      category,
      rateIdr: null,
      monthlyCostIdr: null,
      paused: false,
      ...limits,
    });
  }
  async getCap(n: string, c: string): Promise<WaCapRecord | null> {
    return this.caps.get(`${n}|${c}`) ?? null;
  }
  async listCaps(n: string): Promise<WaCapRecord[]> {
    return [...this.caps.values()].filter((c) => c.waNumber === n);
  }
  async upsertCap(n: string, c: string, limits: Omit<WaCapLimits, 'paused'>): Promise<void> {
    this.setCap(c, limits, n);
  }
  async setPausedAll(n: string, paused: boolean): Promise<number> {
    const rows = await this.listCaps(n);
    rows.forEach((r) => (r.paused = paused));
    return rows.length;
  }
  async reserve(n: string, month: string, category: WaCategory): Promise<WaReserveResult> {
    const cap = await this.getCap(n, category);
    const k = this.key(n, month, category);
    const c = this.counters.get(k) ?? { waNumber: n, monthKey: month, category, messages: 0, costIdr: 0, warnedAt: null, stoppedAt: null };
    const r = reservation(cap, c, cap ? rateFor(category, cap) : null);
    if (!r.ok) return r;
    this.counters.set(k, { ...c, messages: r.messages, costIdr: r.costIdr });
    return { ...r, warn: r.messages >= warnThreshold(cap!.monthlyMessages) };
  }
  async release(n: string, month: string, category: WaCategory): Promise<void> {
    this.releases.push(`${month}|${category}`);
    const c = this.counters.get(this.key(n, month, category));
    if (c && c.messages > 0) c.messages -= 1;
  }
  async markWarned(n: string, month: string, category: WaCategory, at: Date): Promise<boolean> {
    const c = this.counters.get(this.key(n, month, category));
    if (!c || c.warnedAt) return false;
    c.warnedAt = at;
    return true;
  }
  async markStopped(n: string, month: string, category: WaCategory, at: Date): Promise<boolean> {
    const c = this.counters.get(this.key(n, month, category));
    if (!c || c.stoppedAt) return false;
    c.stoppedAt = at;
    return true;
  }
  async listCounters(month: string): Promise<WaCounterRecord[]> {
    return [...this.counters.values()].filter((c) => c.monthKey === month);
  }
}

export class FakeTemplates implements WaTemplateRepository {
  rows: WaTemplateRecord[] = [];
  async list(): Promise<WaTemplateRecord[]> {
    return this.rows;
  }
  async ensure(t: { name: string; language: string; event: string | null; category: string; bodyParams: number }): Promise<void> {
    if (!this.rows.some((r) => r.name === t.name && r.language === t.language)) {
      this.rows.push({ ...t, id: randomUUID(), status: 'DRAFT', statusReason: null });
    }
  }
  async setStatus(name: string, language: string, status: string, reason: string | null): Promise<boolean> {
    const r = this.rows.find((x) => x.name === name && x.language === language);
    if (!r) return false;
    Object.assign(r, { status, statusReason: reason });
    return true;
  }
  async get(name: string, language: string): Promise<WaTemplateRecord | null> {
    return this.rows.find((r) => r.name === name && r.language === language) ?? null;
  }
}

/** Runs the body on the shared fakes; a throw restores the dedupe keys and ledger length (a rollback). */
export class FakeTx implements WaTransactionRepository {
  constructor(
    private readonly consent: FakeConsent,
    private readonly messages: FakeMessages,
    private readonly caps: FakeCaps,
  ) {}
  async transaction<T>(
    fn: (tx: { consent: WaConsentRepository; messages: WaMessageRepository; caps: WaCapRepository }) => Promise<T>,
  ): Promise<T> {
    const inbound = new Set(this.messages.inbound);
    const rows = this.consent.rows.length;
    try {
      return await fn({ consent: this.consent, messages: this.messages, caps: this.caps });
    } catch (e) {
      this.messages.inbound = inbound;
      this.consent.rows.length = rows;
      throw e;
    }
  }
}

export class FakeSender implements WhatsappSenderPort {
  templates: Array<{ to: string; name: string; language: string; params: string[] }> = [];
  texts: Array<{ to: string; body: string }> = [];
  next: WaSendResult | null = null;
  /** Runs just before the HTTP call: how a test lands a STOP at the wrong moment. */
  beforeSend: (() => Promise<void> | void) | null = null;
  private n = 0;
  private async result(): Promise<WaSendResult> {
    await this.beforeSend?.();
    return this.next ?? { ok: true, messageId: `wamid.${(this.n += 1)}` };
  }
  async sendTemplate(input: { to: string; name: string; language: string; params: string[] }): Promise<WaSendResult> {
    const r = await this.result();
    if (r.ok) this.templates.push(input);
    return r;
  }
  async sendText(input: { to: string; body: string }): Promise<WaSendResult> {
    const r = await this.result();
    if (r.ok) this.texts.push(input);
    return r;
  }
}
