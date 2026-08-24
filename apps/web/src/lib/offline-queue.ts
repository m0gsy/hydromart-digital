'use client';

import { api, ApiError, uploadFile } from './api';
import { onResume } from './app-lifecycle';
import { endpoints } from './endpoints';
import { getSession } from './session-store';

/**
 * Offline capture queue for the field surfaces that must not lose work when the signal
 * drops: the HR face punch, the courier shift check-in, proof of delivery — and, since K2.9,
 * every remaining courier action that changes something the courier cannot redo.
 *
 * K2.9: proof of delivery was the ONLY courier action in here, which meant a courier in a
 * dead spot could queue the evidence that they delivered and not the CASH they had just been
 * handed. COD confirmation, the empty-gallon return (a deposit refund), marking a delivery
 * failed and rescheduling it all called the API directly, so the signal dropping lost them.
 * The money one is the worst of the four: the customer has paid, the courier is holding the
 * notes, and nothing anywhere records it.
 *
 * Only these enqueue — a queue behind every call would replay reads and stale writes.
 * Each job carries the device capture time; the server clamps it (it can never be later than
 * the sync, nor older than the depot's offline window) and, for a punch, sends a late sync to
 * HR for approval. A job rejected on business grounds is kept with its message and never
 * retried; the operator discards it.
 *
 * ponytail: IndexedDB, not localStorage — a proof photo plus a face frame blow the ~5 MB
 * localStorage quota. Flush runs on the `online` event, on mount and on demand; Background
 * Sync would need a service worker that can rebuild multipart uploads, so it waits until
 * someone actually reports losing work with the tab closed.
 */

const DB_NAME = 'hm.offline';
const STORE = 'jobs';

export type JobKind =
  | 'hrPunch'
  | 'shiftCheckIn'
  | 'pod'
  | 'codConfirm'
  | 'gallonReturn'
  | 'deliveryFail'
  | 'deliveryReschedule';

export interface HrPunchPayload {
  mode: 'in' | 'out';
  image: string;
  lat: number;
  lng: number;
}

export interface ShiftCheckInPayload {
  depotId: string;
  lat: number;
  lng: number;
}

export interface PodPayload {
  deliveryId: string;
  orderNumber: string;
  /** Data URLs — the File objects themselves cannot survive a reload. */
  photo: string;
  signature?: string;
  recipientName: string;
  latitude: number;
  longitude: number;
  note?: string;
}

/**
 * K2.9: the cash a courier has already taken.
 *
 * `capturedAt` travels with it and payment-service clamps it onto `paidAt`, because a COD
 * collected at 16:00 and synced at 19:00 belongs to the 16:00 shift. Without that the money
 * would land in whichever shift happened to be open when the signal came back, and shift
 * close would come out short in one drawer and over in another.
 */
export interface CodConfirmPayload {
  paymentId: string;
  cashReceived: number;
}

/** A deposit refund the courier has already handed over in empties. */
export interface GallonReturnPayload {
  depotId: string;
  orderId: string;
  customerId?: string;
  quantity: number;
  condition: string;
  note?: string;
}

export interface DeliveryFailPayload {
  deliveryId: string;
  reason: string;
}

export interface DeliveryReschedulePayload {
  deliveryId: string;
  rescheduledFor: string;
  slot?: string;
  note?: string;
}

export type Job =
  | { kind: 'hrPunch'; payload: HrPunchPayload }
  | { kind: 'shiftCheckIn'; payload: ShiftCheckInPayload }
  | { kind: 'pod'; payload: PodPayload }
  | { kind: 'codConfirm'; payload: CodConfirmPayload }
  | { kind: 'gallonReturn'; payload: GallonReturnPayload }
  | { kind: 'deliveryFail'; payload: DeliveryFailPayload }
  | { kind: 'deliveryReschedule'; payload: DeliveryReschedulePayload };

export type QueuedJob = Job & {
  id: string;
  capturedAt: string;
  /**
   * H-24: who captured it. A depot phone is shared — a courier queues a punch offline,
   * hands the phone over, the next person signs in, and the flush used to post THEIR
   * session with the first courier's face frame, filing one person's attendance against
   * the other. Absent only on jobs queued before this shipped.
   */
  owner?: string | null;
  /** Set once the server refused the job for good; it stays until the user discards it. */
  error?: string;
  /** E5: how many times sending has been tried and failed for a reason worth retrying. */
  attempts?: number;
  /** E5: the earliest time worth trying again. Absent means "now". */
  nextAttemptAt?: string;
};

/**
 * E5. How many transient failures a job absorbs before it stops being invisible.
 *
 * Not unbounded: a job that fails the same way forever is a job nobody will ever be told
 * about, and silence is the failure mode this whole file exists to prevent. When the count
 * runs out the job is marked with its last message, which is what puts it in front of the
 * operator.
 */
export const MAX_ATTEMPTS = 6;

/**
 * E5. How long a captured job may sit unsent before it is dropped.
 *
 * The payloads here are a face frame for an HR punch and a delivery photo plus a
 * signature — biometric and personal data, unencrypted in IndexedDB, on a depot phone
 * people hand to each other. A punch nobody has managed to sync in a week is not going to
 * become useful; the image staying on that phone forever is the part that can still do
 * harm. So the retention rule is about the payload, not about the punch.
 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 30s, 1m, 2m, 4m, 8m, capped at 15m — the shape of a deploy, then of an outage. */
function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** (attempts - 1), 15 * 60_000);
}

type Listener = (jobs: QueuedJob[]) => void;

const listeners = new Set<Listener>();
let cache: QueuedJob[] = [];
let hydrated = false;
let flushing: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        // Close on the way out: a connection left open blocks any later version change or
        // deletion of the database, which then hangs rather than failing.
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error('IndexedDB write failed'));
        };
      }),
  );
}

function emit(): void {
  const mine = pending();
  listeners.forEach((fn) => fn(mine));
}

/** Load the stored queue once per page load. Safe to call repeatedly. */
export async function hydrate(): Promise<QueuedJob[]> {
  if (hydrated || typeof indexedDB === 'undefined') return cache;
  try {
    cache = ((await tx<QueuedJob[]>('readonly', (s) => s.getAll())) ?? []).sort((a, b) =>
      a.capturedAt.localeCompare(b.capturedAt),
    );
    // E5: only NOW. This used to be set before the read, so a `getAll()` that threw left
    // `cache = []` and `hydrated = true` for the rest of the page load — queued work
    // present on disk, invisible in the UI and skipped by every flush, with no retry.
    hydrated = true;
  } catch {
    cache = [];
  }
  emit();
  return cache;
}

/** The signed-in customer id, or null when nobody is signed in on this device. */
function currentOwner(): string | null {
  return getSession()?.customer?.id ?? null;
}

/**
 * Jobs the signed-in user may see and send. A job left by someone else stays on the
 * device, invisible and unsent, until they sign back in.
 *
 * An `owner`-less job predates H-24 and can only have come from this device's previous
 * session, so it is still flushed rather than stranded — a window one deploy wide.
 */
function ownedByCurrent(job: QueuedJob): boolean {
  const owner = currentOwner();
  return job.owner == null || job.owner === owner;
}

export function pending(): QueuedJob[] {
  return cache.filter(ownedByCurrent);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function put(job: QueuedJob): Promise<void> {
  await tx('readwrite', (s) => s.put(job, job.id));
  cache = [...cache.filter((j) => j.id !== job.id), job];
  emit();
}

export async function discard(id: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    // A row we cannot delete is a row the user asked to be rid of — drop it from view anyway.
  }
  cache = cache.filter((j) => j.id !== id);
  emit();
}

/** Send a job now. Used both for the live attempt and for every flush. */
async function run(job: Job, capturedAt: string): Promise<unknown> {
  if (job.kind === 'hrPunch') {
    const { mode, ...rest } = job.payload;
    return api.post(
      mode === 'in' ? endpoints.hr.checkIn : endpoints.hr.checkOut,
      { ...rest, capturedAt },
      true,
    );
  }
  if (job.kind === 'shiftCheckIn') {
    return api.post(endpoints.deliveries.shifts.checkIn, { ...job.payload, capturedAt }, true);
  }
  // K2.9. The cash first: this is the one where the customer has already paid.
  if (job.kind === 'codConfirm') {
    const { paymentId, cashReceived } = job.payload;
    return api.post(endpoints.payments.confirm(paymentId), { cashReceived, capturedAt }, true);
  }
  /*
   * No `capturedAt` here, and the reason is worth stating rather than leaving as an
   * inconsistency next to the COD job above.
   *
   * The global pipe runs `forbidNonWhitelisted`, so a field a DTO does not declare is a 400.
   * COD earns the field because `paidAt` already exists and decides which cashier's shift
   * the notes belong to — get that wrong and one drawer is short while another is over. A
   * gallon return has no such column and no shift dimension; giving it one is a schema
   * decision, not a queueing one. Recorded at sync time, which is late but true, instead of
   * lost entirely — which is what happened before.
   */
  if (job.kind === 'gallonReturn') {
    return api.post(endpoints.deliveries.gallonReturns.create, job.payload, true);
  }
  /*
   * PATCH, not POST — the service declares both of these that way, and posting to them
   * returns 404, which `isRetryable` would read as a refusal and throw at the courier.
   *
   * And NO `capturedAt` on these two, unlike the money jobs above. The global pipe runs
   * `forbidNonWhitelisted`, so a field a DTO does not declare is a 400 — and declaring one
   * these services would then ignore is a field that lies. What the two money jobs need it
   * for (which shift the cash belongs to, when the deposit moved) has no equivalent here:
   * the status history records when the state changed, and for a queued job that IS the
   * sync. If that ever needs to be the doorstep time instead, it is a DTO plus a clamp in
   * delivery-service, not a change here.
   */
  if (job.kind === 'deliveryFail') {
    const { deliveryId, reason } = job.payload;
    return api.patch(endpoints.deliveries.driver.fail(deliveryId), { reason }, true);
  }
  if (job.kind === 'deliveryReschedule') {
    const { deliveryId, ...rest } = job.payload;
    return api.patch(endpoints.deliveries.driver.reschedule(deliveryId), rest, true);
  }
  const p = job.payload;
  const photoUrl = await uploadDataUrl(p.photo, 'photo.jpg', 'image/jpeg');
  const signatureUrl = p.signature
    ? await uploadDataUrl(p.signature, 'signature.png', 'image/png')
    : undefined;
  return api.post(
    endpoints.deliveries.driver.complete(p.deliveryId),
    {
      photoUrl,
      signatureUrl,
      recipientName: p.recipientName,
      latitude: p.latitude,
      longitude: p.longitude,
      note: p.note,
      capturedAt,
    },
    true,
  );
}

async function uploadDataUrl(dataUrl: string, name: string, type: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const { url } = await uploadFile(endpoints.deliveries.driver.upload, new File([blob], name, {
    type: blob.type || type,
  }));
  return url;
}

/** True when the failure is "the network isn't there", as opposed to a real rejection. */
function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}

/**
 * Session gone. Deliberately NOT folded into isOffline(): a 401 at capture time means the
 * courier must sign in again, and swallowing it into the queue leaves them staring at a
 * screen that quietly did nothing. A job ALREADY queued is a different story — the punch
 * itself is still valid, so flush() keeps it and retries after the next sign-in.
 */
function isUnauthenticated(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

/**
 * E5. Worth trying again, as opposed to refused.
 *
 * The old code had no such idea: anything that was not status 0 or 401 was written down as
 * a final refusal, and a job carrying one is skipped by every later flush. So one 502 from
 * the gateway during a deploy — the most ordinary failure this app has — permanently killed
 * a courier's queued punch, and only an operator noticing and discarding it cleared it.
 *
 * 5xx is us and will be gone shortly. 408 and 429 are explicitly "come back". Anything else
 * in the 4xx range is the server saying no on the merits — already checked in, outside the
 * geofence, delivery already closed — and retrying that is just noise.
 *
 * A failure that is not an `ApiError` at all (the photo upload's `fetch`, a blob that will
 * not read) counts as retryable too: the realistic cause is the same dropped connection,
 * and `MAX_ATTEMPTS` stops a genuinely broken payload from looping forever.
 */
function isRetryable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
}

/** Past the retention window: the payload has to go, whatever became of the job. */
function expired(job: QueuedJob, now: number): boolean {
  const captured = Date.parse(job.capturedAt);
  return Number.isFinite(captured) && now - captured > RETENTION_MS;
}

/**
 * Try the job now; queue it if the device is offline. Anything else (already checked in,
 * outside the geofence, delivery already closed) still throws so the caller can show it.
 */
export async function runOrQueue<T = unknown>(
  job: Job,
): Promise<{ outcome: 'sent'; result: T } | { outcome: 'queued'; result?: undefined }> {
  await hydrate();
  const capturedAt = new Date().toISOString();
  try {
    return { outcome: 'sent', result: (await run(job, capturedAt)) as T };
  } catch (e) {
    // E5: a 5xx at capture used to propagate to the caller, and the work was simply gone —
    // the courier saw an error, the punch existed nowhere. Anything retryable is captured
    // now; only a real refusal still throws, because that one the courier must be told.
    if (!isRetryable(e)) throw e;
    await put({ ...job, id: crypto.randomUUID(), capturedAt, owner: currentOwner() });
    return { outcome: 'queued' };
  }
}

/**
 * Push everything queued. Jobs the server refuses on business grounds are marked and left
 * for the user to discard; jobs that fail because we are still offline stay untouched.
 */
export async function flush(ignoreBackoff = false): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    await hydrate();
    const now = Date.now();
    for (const job of [...cache]) {
      if (!ownedByCurrent(job)) continue;
      // Checked before `job.error`, so a refused job's face frame does not outlive the
      // window either just because nobody pressed discard.
      if (expired(job, now)) {
        await discard(job.id);
        continue;
      }
      if (job.error) continue;
      // Waiting out its backoff. Skipped rather than returned: a later job may be due.
      if (!ignoreBackoff && job.nextAttemptAt && Date.parse(job.nextAttemptAt) > now) continue;
      try {
        await run(job, job.capturedAt);
        await discard(job.id);
      } catch (e) {
        // No network, or the session lapsed — keep the rest for the next attempt either way.
        if (isOffline(e) || isUnauthenticated(e)) return;
        const message = e instanceof Error ? e.message : 'Gagal mengirim';
        if (!isRetryable(e)) {
          await put({ ...job, error: message });
          continue;
        }
        const attempts = (job.attempts ?? 0) + 1;
        await put(
          attempts >= MAX_ATTEMPTS
            ? // Out of attempts. Marked, because a job that keeps failing silently is a job
              // nobody will ever be told about — which is the failure this file exists to
              // prevent. The message is the last real one from the server.
              { ...job, attempts, error: message }
            : {
                ...job,
                attempts,
                nextAttemptAt: new Date(now + backoffMs(attempts)).toISOString(),
              },
        );
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * Flush now, ignoring every backoff timer. For the "coba lagi" the operator presses when
 * they know the gateway is back — waiting out a 15-minute window in front of someone who
 * can see the queue is its own kind of broken.
 */
export function flushNow(): Promise<void> {
  return flush(true);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush());
  // The `online` event alone is not a plan on Android. A WebView reports connectivity
  // through `navigator.onLine`, which is unreliable there, and the only other trigger is
  // the queue banner mounting — which happens once, because it lives in the driver
  // layout and navigating between courier screens does not remount it. A courier who
  // regains signal while sitting on the same screen sent nothing until they came back to
  // the app. Coming back to the app is now the trigger.
  onResume(() => void flush());
}
