// Web Push client (design 7b transport). Registers the service worker, negotiates a
// PushSubscription with the crm VAPID key, and syncs it to crm-service. All calls are
// no-ops / return 'unsupported' when the browser lacks push or no VAPID key is set.
import { api } from './api';
import { endpoints } from './endpoints';

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/sw.js');
  return existing ?? navigator.serviceWorker.register('/sw.js');
}

/** Current push state without prompting for permission. */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'subscribed' : 'unsubscribed';
}

/** Ask permission, subscribe, and register the endpoint with crm-service. */
export async function subscribeToPush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'unsubscribed';

  const { key } = await api.get<{ key: string }>(endpoints.push.vapidKey, true);
  if (!key) return 'unsupported'; // server has no VAPID key configured → push is off

  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  const json = sub.toJSON();
  await api.post(
    endpoints.push.subscribe,
    { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } },
    true,
  );
  return 'subscribed';
}

/** Unsubscribe locally and remove the endpoint from crm-service. */
export async function unsubscribeFromPush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await api.del(`${endpoints.push.unsubscribe}?endpoint=${encodeURIComponent(sub.endpoint)}`, true);
    await sub.unsubscribe();
  }
  return 'unsubscribed';
}
