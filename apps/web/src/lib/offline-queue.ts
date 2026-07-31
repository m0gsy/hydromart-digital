'use client';

import { api, ApiError, uploadFile } from './api';
import { endpoints } from './endpoints';

/**
 * Offline capture queue for the three field surfaces that must not lose work when the
 * signal drops: the HR face punch, the courier shift check-in, and proof of delivery.
 *
 * Only these three enqueue — a queue behind every call would replay reads and stale writes.
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

export type JobKind = 'hrPunch' | 'shiftCheckIn' | 'pod';

export interface HrPunchPayload {
  mode: 'in' | 'out';
  image: string;
  live: boolean;
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

export type Job =
  | { kind: 'hrPunch'; payload: HrPunchPayload }
  | { kind: 'shiftCheckIn'; payload: ShiftCheckInPayload }
  | { kind: 'pod'; payload: PodPayload };

export type QueuedJob = Job & {
  id: string;
  capturedAt: string;
  /** Set once the server refused the job for good; it stays until the user discards it. */
  error?: string;
};

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
  listeners.forEach((fn) => fn(cache));
}

/** Load the stored queue once per page load. Safe to call repeatedly. */
export async function hydrate(): Promise<QueuedJob[]> {
  if (hydrated || typeof indexedDB === 'undefined') return cache;
  hydrated = true;
  try {
    cache = ((await tx<QueuedJob[]>('readonly', (s) => s.getAll())) ?? []).sort((a, b) =>
      a.capturedAt.localeCompare(b.capturedAt),
    );
  } catch {
    cache = [];
  }
  emit();
  return cache;
}

export function pending(): QueuedJob[] {
  return cache;
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
    if (!isOffline(e)) throw e;
    await put({ ...job, id: crypto.randomUUID(), capturedAt });
    return { outcome: 'queued' };
  }
}

/**
 * Push everything queued. Jobs the server refuses on business grounds are marked and left
 * for the user to discard; jobs that fail because we are still offline stay untouched.
 */
export async function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    await hydrate();
    for (const job of [...cache]) {
      if (job.error) continue;
      try {
        await run(job, job.capturedAt);
        await discard(job.id);
      } catch (e) {
        // No network, or the session lapsed — keep the rest for the next attempt either way.
        if (isOffline(e) || isUnauthenticated(e)) return;
        await put({ ...job, error: e instanceof Error ? e.message : 'Gagal mengirim' });
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush());
}
