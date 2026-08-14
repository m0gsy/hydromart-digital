// Web Push client (design 7b transport). Registers the service worker, negotiates a
// PushSubscription with the crm VAPID key, and syncs it to crm-service. All calls are
// no-ops / return 'unsupported' when the browser lacks push or no VAPID key is set.
import { api } from './api';
import { askPlugin, onPluginEvent } from './capacitor';
import { vaultClear, vaultRead, vaultWrite } from './secure-vault';
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

/**
 * E4. Where the registered endpoint is remembered.
 *
 * Not `localStorage`: `token-store.ts:203-206` already argues at length that Android
 * evicts WebView localStorage on its own schedule, and this file used to infer the whole
 * subscription state from a key living there. An eviction therefore read as "never
 * subscribed" while the server still held a live endpoint. The Keystore is the same store
 * the session already trusts, and `SecureStorage` raises no biometric prompt.
 *
 * The old localStorage key is still read once, so an install that upgrades into this build
 * does not re-POST an endpoint the server already has.
 */
async function readEndpoint(): Promise<string | null> {
  const res = await vaultRead(FCM_ENDPOINT_KEY);
  if (res.ok && res.data) return res.data;
  // A failed read is NOT an absence (an invalidated Keystore key reads as a failure), but
  // for this value the safe answer to both is the same: re-register. The cost is one POST.
  try {
    return window.localStorage.getItem(FCM_ENDPOINT_KEY);
  } catch {
    return null;
  }
}

async function writeEndpoint(endpoint: string): Promise<void> {
  await vaultWrite(endpoint, FCM_ENDPOINT_KEY);
  // Both, deliberately. The Keystore is the durable copy — it is what survives the
  // localStorage eviction this used to lose the subscription to. But `vaultWrite` cannot
  // report a missing plugin, so a build or device without SecureStorage would silently
  // remember nothing at all and report 'unsubscribed' forever. Writing the old key as well
  // costs nothing and keeps the previous behaviour as the floor rather than the ceiling.
  try {
    window.localStorage.setItem(FCM_ENDPOINT_KEY, endpoint);
  } catch {
    /* the vault is the copy that matters */
  }
}

async function clearEndpoint(): Promise<void> {
  await vaultClear(FCM_ENDPOINT_KEY);
  try {
    window.localStorage.removeItem(FCM_ENDPOINT_KEY);
  } catch {
    /* nothing to clean up */
  }
}

/** The endpoint this device is registered under, or null. Exported for tests. */
export async function nativeEndpoint(): Promise<string | null> {
  return readEndpoint();
}

/** Tokens whose POST is in flight, so the permanent listener and `nativeSubscribe` — both
 *  of which see the same `registration` event — do not each send one. */
const inFlight = new Set<string>();

async function syncToken(token: string): Promise<void> {
  const endpoint = `fcm:${token}`;
  if (inFlight.has(endpoint)) return;
  if ((await readEndpoint()) === endpoint) return;
  inFlight.add(endpoint);
  try {
    await api.post(endpoints.push.subscribe, { endpoint }, true);
    await writeEndpoint(endpoint);
  } catch {
    // Deliberately keeps the PREVIOUS endpoint. Storing the new one before the server
    // has it would make the next event dedupe against a registration that never happened,
    // and the retry would never come.
  } finally {
    inFlight.delete(endpoint);
  }
}

/**
 * E4. One `registration` listener that outlives the handshake.
 *
 * `fcmToken()` below removes its own listener as soon as the first token lands, which is
 * right for a one-shot handshake and wrong for the rest of the app's life: FCM rotates the
 * registration token (app restore, cleared data, a Play Services refresh) and emits
 * `registration` again. With nobody subscribed, the app kept a `fcm:<token>` the server
 * could no longer deliver to — and every signal still said push was fine, so there was no
 * path back for the user or for us.
 *
 * Listening costs nothing and needs no permission; it simply never fires until FCM has
 * something to say.
 */
export function startPushTokenSync(): () => void {
  if (!isNativeShell()) return () => {};
  return onPluginEvent('PushNotifications', 'registration', (t: { value?: string }) => {
    if (t?.value) void syncToken(t.value);
  });
}

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
  return (await readEndpoint()) ? 'subscribed' : 'unsubscribed';
}

/**
 * The notification channel every push lands in. Must match
 * `com.google.firebase.messaging.default_notification_channel_id` in the manifest — a
 * mismatch is silent, and Android quietly files everything into "Miscellaneous" instead.
 *
 * Android 8+ takes importance from the channel, not the message: without one of our own,
 * order updates arrive at default importance with no heads-up and no sound, and the only
 * control the user has is to turn the whole app off. Creating it is idempotent, and it
 * has to exist before the first notification or that one lands in the fallback channel.
 */
async function ensureChannel(): Promise<void> {
  await askPlugin('PushNotifications', 'createChannel', {
    id: 'hydromart_orders',
    // i18n-ok (name + description): Android caches a notification channel's name at
    // creation and ignores later edits under the same id. A locale-dependent name would
    // freeze whichever language happened to run first, per device, forever.
    name: 'Pesanan & pengiriman',
    description: 'Status pesanan, kurir dalam perjalanan, poin dan voucher.',
    importance: 4, // IMPORTANCE_HIGH — a heads-up banner, which is the point of the message
    visibility: 1, // VISIBILITY_PUBLIC: the lock screen may show it; nothing here is a secret
  });
}

async function nativeSubscribe(): Promise<PushState> {
  const status = await askPlugin<{ receive?: string }>('PushNotifications', 'requestPermissions');
  // Android 13+ makes POST_NOTIFICATIONS a runtime permission, and a denial cannot be
  // re-asked easily — which is why this is only ever called from a deliberate action.
  if (status?.receive !== 'granted')
    return status?.receive === 'denied' ? 'denied' : 'unsubscribed';

  await ensureChannel();

  const token = await fcmToken();
  if (!token) return 'unsupported';

  const endpoint = `fcm:${token}`;
  await api.post(endpoints.push.subscribe, { endpoint }, true);
  await writeEndpoint(endpoint);
  return 'subscribed';
}

async function nativeUnsubscribe(): Promise<PushState> {
  const endpoint = await readEndpoint();
  if (endpoint) {
    await api.del(`${endpoints.push.unsubscribe}?endpoint=${encodeURIComponent(endpoint)}`, true);
    await clearEndpoint();
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
 * protecting users from, and the second dialog would never appear anyway. It also
 * survives a dismissal, for the same reason — Android turns a second dismissal into a
 * permanent denial, so a retry there spends the user's last answer.
 *
 * What it does NOT survive is a failure AFTER the permission was granted: no Play
 * Services, no registration token, or a `POST /push/subscribe` that did not reach
 * crm-service. Writing the flag before the attempt — which is what this did first —
 * turned every one of those into a device that had granted permission and would never
 * be registered, with nothing left to try again. Those cases leave the flag unset; the
 * permission dialog will not reappear (it is already granted) so the retry is silent.
 *
 * Called from the moment the notification explains itself in each binary: after a
 * customer's first order is placed, and after a courier's first shift check-in.
 */
export async function requestPushOnce(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    if (window.localStorage.getItem(ASKED_KEY)) return;
  } catch {
    return; // no storage to remember the ask by — better to never ask than to ask always
  }
  // `null` is a thrown subscribe (the endpoint POST); 'unsupported' is a granted
  // permission with no token behind it. Both are worth another go.
  const state = await subscribeToPush().catch(() => null);
  if (state === null || state === 'unsupported') return;
  try {
    window.localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* asked, but nothing to remember it by — the dialog itself will not come back */
  }
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
