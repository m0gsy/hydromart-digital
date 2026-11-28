import { WaCapLimits, WaCategory } from '../../domain/wa-cost';

/**
 * HD-12/HD-13: storage ports for WhatsApp number 1. Nothing calls them yet (schema one release before its
 * reader); the sender and the webhook arrive in the next release.
 */

export interface WaConsentInput {
  phone: string;
  customerId: string | null;
  waNumber: string;
  purpose: string;
  legalEntity: string;
  granted: boolean;
  textVersion: string;
  source: string;
  sourceRef: string | null;
  depotId: string | null;
  /** When the person acted, if that is not now (the AI web's STOP/MULAI carry their own time). */
  recordedAt?: Date;
}

export interface WaConsentRecord extends WaConsentInput {
  id: string;
  seq: bigint;
  channel: string;
  recordedAt: Date;
}

export interface WaOptInCodeRecord {
  id: string;
  code: string;
  kind: string;
  customerId: string | null;
  depotId: string | null;
  createdBy: string;
  expiresAt: Date;
  usedAt: Date | null;
  usedPhone: string | null;
}

export interface WaConsentRepository {
  /** Appends a row. False = (source, sourceRef) was already there, so a replay changed nothing. */
  append(input: WaConsentInput): Promise<boolean>;
  listForPhone(phone: string): Promise<WaConsentRecord[]>;
  /** The rows of many phones at once (the depot CRM list), bounded. */
  listForPhones(phones: string[]): Promise<WaConsentRecord[]>;
  /** Number 1 UTILITY rows of one customer, newest last. */
  listUtilityForCustomer(customerId: string): Promise<WaConsentRecord[]>;
  /**
   * The STOP-list feed for the AI web: rows not written by it, after a cursor.
   * CONTRACT: `seq` is a BIGSERIAL and is NOT commit-ordered: a lower seq can commit after a higher one was
   * already read, so a puller that trusts the cursor alone skips it. The caller must re-read an overlap window
   * (seq > cursor - 1000, or recordedAt within the last 2 minutes) and dedupe on `id`. PR-B implements that.
   */
  listAfter(afterSeq: bigint, limit: number): Promise<WaConsentRecord[]>;
  createCode(input: {
    code: string;
    kind: string;
    customerId: string | null;
    depotId: string | null;
    createdBy: string;
    expiresAt: Date;
  }): Promise<WaOptInCodeRecord>;
  findCode(code: string): Promise<WaOptInCodeRecord | null>;
  findCodeById(id: string): Promise<WaOptInCodeRecord | null>;
  /** Single use: one conditional UPDATE, so of two numbers claiming one code exactly one gets it. */
  claimCode(code: string, phone: string, now: Date): Promise<WaOptInCodeRecord | null>;
  /** When the AI web last pulled the STOP list; null if it never has. */
  peerLastOkAt(peer: string): Promise<Date | null>;
  stampPeer(peer: string, now: Date, lastSeq: bigint): Promise<void>;
  /** Retention: phones whose newest row is a grant and older than the cutoff go; a number last seen as STOP stays. */
  purgeBefore(cutoff: Date): Promise<number>;
}

export interface WaMessageInput {
  notificationId: string | null;
  dedupeKey: string;
  customerId: string | null;
  phone: string;
  waNumber: string;
  category: WaCategory;
  templateName: string;
  language: string;
  vars: Record<string, string>;
  status: 'QUEUED' | 'SKIPPED';
  skipReason: string | null;
  monthKey: string;
}

export interface WaMessageRecord {
  id: string;
  dedupeKey: string;
  phone: string;
  waNumber: string;
  category: string;
  templateName: string;
  language: string;
  vars: Record<string, string>;
  status: string;
  skipReason: string | null;
  metaMessageId: string | null;
  attempts: number;
  monthKey: string;
  createdAt: Date;
}

/** `customerId` is not on the record: the send path decides on the phone, which is what Meta needs. */
export interface WaMessageRepository {
  /** False = this dedupe key was already queued or sent: stop, never send twice. */
  insertIfNew(input: WaMessageInput): Promise<boolean>;
  findByDedupeKey(dedupeKey: string): Promise<WaMessageRecord | null>;
  markSent(id: string, metaMessageId: string, at: Date): Promise<void>;
  /** Stays QUEUED for the sweep to retry, with the attempt counted. */
  markRetry(id: string): Promise<void>;
  markFailed(id: string, errorCode: string | null, error: string, at: Date): Promise<void>;
  /** STOP: every message of this phone still waiting is cancelled. Returns them, so the caller gives their cap back. */
  cancelQueuedForPhone(phone: string): Promise<WaMessageRecord[]>;
  /** Claims up to `limit` QUEUED rows not claimed since `staleBefore`, for the retry sweep. */
  claimQueued(limit: number, token: string, now: Date, staleBefore: Date): Promise<WaMessageRecord[]>;
  /** False = already seen (a Meta retry): process nothing. */
  recordInbound(eventKey: string, kind: string): Promise<boolean>;
  /** A QUEUED row that cannot go after all (cap, pause): kept with the reason, so HQ sees why. */
  markSkipped(id: string, reason: string): Promise<void>;
  /** True when the row was still QUEUED and is now CANCELLED (a STOP landed first). */
  markCancelled(id: string): Promise<boolean>;
  /**
   * Meta's delivery report. Forward only (SENT < DELIVERED < READ); FAILED overrides until DELIVERED. Null = no
   * such message here; `changed` false = a late or repeated report that moved nothing.
   */
  applyStatus(
    metaMessageId: string,
    status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
    at: Date,
    error: { code: string | null; text: string } | null,
  ): Promise<{ record: WaMessageRecord; changed: boolean } | null>;
  /** When number 1 last answered this phone in free text (the once-a-day auto reply). */
  lastServiceReplyAt(phone: string): Promise<Date | null>;
  /** The newest refusals and failures for HQ; NO_CONSENT is the normal case for most customers and is left out. */
  listProblems(limit: number): Promise<WaMessageRecord[]>;
  purgeMessagesBefore(cutoff: Date): Promise<number>;
  purgeInboundBefore(cutoff: Date): Promise<number>;
}

export interface WaCapRecord extends WaCapLimits {
  waNumber: string;
  category: string;
}

export interface WaCounterRecord {
  waNumber: string;
  monthKey: string;
  category: string;
  messages: number;
  costIdr: number;
  warnedAt: Date | null;
  stoppedAt: Date | null;
}

export type WaReserveResult =
  | { ok: true; messages: number; costIdr: number; warn: boolean; reachesCap: boolean }
  | { ok: false; reason: 'CAP' | 'PAUSED' };

export interface WaCapRepository {
  getCap(waNumber: string, category: string): Promise<WaCapRecord | null>;
  listCaps(waNumber: string): Promise<WaCapRecord[]>;
  upsertCap(waNumber: string, category: string, limits: Omit<WaCapLimits, 'paused'>, by: string): Promise<void>;
  /** The kill switch: every cap row of the number at once. */
  setPausedAll(waNumber: string, paused: boolean, by: string): Promise<number>;
  /** Counts one message against the month, atomically; a refusal changes nothing. */
  reserve(waNumber: string, monthKey: string, category: WaCategory): Promise<WaReserveResult>;
  /** Gives one back (Meta refused it, or said it was not billable). */
  release(waNumber: string, monthKey: string, category: WaCategory): Promise<void>;
  /** True only for the one caller that sets it, so the warning is filed exactly once. */
  markWarned(waNumber: string, monthKey: string, category: WaCategory, at: Date): Promise<boolean>;
  markStopped(waNumber: string, monthKey: string, category: WaCategory, at: Date): Promise<boolean>;
  listCounters(monthKey: string): Promise<WaCounterRecord[]>;
}

export interface WaTemplateRecord {
  id: string;
  name: string;
  language: string;
  event: string | null;
  category: string;
  bodyParams: number;
  status: string;
  statusReason: string | null;
}

export interface WaTemplateRepository {
  list(): Promise<WaTemplateRecord[]>;
  /** Registers a template as DRAFT when it is not there yet; an existing row (and its status) is left alone. */
  ensure(template: { name: string; language: string; event: string | null; category: string; bodyParams: number }): Promise<void>;
  setStatus(name: string, language: string, status: string, reason: string | null): Promise<boolean>;
  get(name: string, language: string): Promise<WaTemplateRecord | null>;
}

/** The repositories joined in ONE database transaction: a webhook item and its dedupe key stand or fall together. */
export interface WaTransactionRepository {
  transaction<T>(
    fn: (tx: { consent: WaConsentRepository; messages: WaMessageRepository; caps: WaCapRepository }) => Promise<T>,
  ): Promise<T>;
}
