// Web Push client (design 7b transport). Registers the service worker, negotiates a
// PushSubscription with the crm VAPID key, and syncs it to crm-service. All calls are
// no-ops / return 'unsupported' when the browser lacks push or no VAPID key is set.
import { api } from './api';
import { askPlugin, onPluginEvent } from './capacitor';
import { endpoints } from './endpoints';
import { isNativeShell } from './platform';

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

/**
 * F4: on Android the transport is FCM, not Web Push.
 *
 * The WebView is a secure context and reports `serviceWorker` and `PushManager` as
 * present, so the browser path would look supported right up to the point where nothing
 * ever arrives — a service worker in a Capacitor app has no push service behind it. Every
 * entry point below therefore branches on the shell first.
 *
 * The device token is stored server-side as `fcm:<token>` in the same subscription table
 * a browser endpoint uses; the composite sender in crm-service routes on that prefix.
 */
const FCM_ENDPOINT_KEY = 'hm.fcm-endpoint';

export function pushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (isNativeShell()) return true;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
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

/**
 * The FCM registration token, via the plugin's asynchronous `registration` event —
 * `register()` only starts the handshake. Resolves null if it never arrives (no Play
 * Services, no network, a `google-services.json` that does not match the applicationId),
 * so a caller is never left waiting on a promise that cannot settle.
 */
function fcmToken(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      offToken();
      offError();
      clearTimeout(timer);
      resolve(value);
    };
    const offToken = onPluginEvent('PushNotifications', 'registration', (t: { value?: string }) =>
      finish(t?.value ?? null),
    );
    const offError = onPluginEvent('PushNotifications', 'registrationError', () => finish(null));
    const timer = setTimeout(() => finish(null), 15_000);
    void askPlugin('PushNotifications', 'register');
  });
}

async function nativePushState(): Promise<PushState> {
  const status = await askPlugin<{ receive?: string }>('PushNotifications', 'checkPermissions');
  if (status?.receive === 'denied') return 'denied';
  if (status?.receive !== 'granted') return 'unsubscribed';
  return window.localStorage.getItem(FCM_ENDPOINT_KEY) ? 'subscribed' : 'unsubscribed';
}

async function nativeSubscribe(): Promise<PushState> {
  const status = await askPlugin<{ receive?: string }>('PushNotifications', 'requestPermissions');
  // Android 13+ makes POST_NOTIFICATIONS a runtime permission, and a denial cannot be
  // re-asked easily — which is why this is only ever called from a deliberate action.
  if (status?.receive !== 'granted')
    return status?.receive === 'denied' ? 'denied' : 'unsubscribed';

  const token = await fcmToken();
  if (!token) return 'unsupported';

  const endpoint = `fcm:${token}`;
  await api.post(endpoints.push.subscribe, { endpoint }, true);
  window.localStorage.setItem(FCM_ENDPOINT_KEY, endpoint);
  return 'subscribed';
}

async function nativeUnsubscribe(): Promise<PushState> {
  const endpoint = window.localStorage.getItem(FCM_ENDPOINT_KEY);
  if (endpoint) {
    await api.del(`${endpoints.push.unsubscribe}?endpoint=${encodeURIComponent(endpoint)}`, true);
    window.localStorage.removeItem(FCM_ENDPOINT_KEY);
  }
  return 'unsubscribed';
}

/** Whether this install has already been shown the Android permission dialog. */
const ASKED_KEY = 'hm.push-asked';

/**
 * F3b: ask for notification permission once, at the moment it explains itself.
 *
 * `POST_NOTIFICATIONS` is a runtime permission on Android 13+, and a denial is close to
 * permanent — the system stops showing the dialog and the user has to find the app's
 * settings page to change their mind. Asking at first launch, before the person has any
 * reason to want a notification, is the reliable way to collect that denial. So it is
 * asked after their first order is placed, when "tell me when it is on its way" is
 * obviously the point.
 *
 * The flag survives a denial deliberately: re-asking is the behaviour Android is
 * protecting users from, and the second dialog would never appear anyway.
 */
export async function requestPushOnce(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    if (window.localStorage.getItem(ASKED_KEY)) return;
    window.localStorage.setItem(ASKED_KEY, '1');
  } catch {
    return; // no storage to remember the ask by — better to never ask than to ask always
  }
  await subscribeToPush().catch(() => {});
}

/** Current push state without prompting for permission. */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (isNativeShell()) return nativePushState();
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'subscribed' : 'unsubscribed';
}

/** Ask permission, subscribe, and register the endpoint with crm-service. */
export async function subscribeToPush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (isNativeShell()) return nativeSubscribe();
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
  if (isNativeShell()) return nativeUnsubscribe();
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await api.del(
      `${endpoints.push.unsubscribe}?endpoint=${encodeURIComponent(sub.endpoint)}`,
      true,
    );
    await sub.unsubscribe();
  }
  return 'unsubscribed';
}
