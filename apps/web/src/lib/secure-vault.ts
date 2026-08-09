'use client';

import { askPlugin, tryPlugin } from './capacitor';

/**
 * F3b: the two native capabilities the session needs and a WebView has none of — a
 * key-backed place to keep a credential, and a way to ask the person holding the phone
 * to prove they are the owner.
 *
 * Both are reached the same way the rest of the shell reaches plugins: by name at
 * runtime, so `apps/web` keeps its zero `@capacitor/*` dependencies and the browser
 * bundle is untouched. The method names below are the NATIVE ones — `internalGetItem`,
 * `internalAuthenticate` — not the friendlier wrappers, because the wrapper is the JS
 * half of the package and this file deliberately never imports it. That is a real cost:
 * if either plugin renames a native method in a major version, nothing here fails to
 * compile, it fails on a phone. Both are pinned exactly in `mobile/package.json` for
 * that reason, and both are on the first-week device checklist.
 *
 * Fingerprints and faces never leave the device and are never sent anywhere: what is
 * being checked is a local key, not an identity. That is the opposite of HR's face
 * check-in, which really does upload a frame — a distinction the Play Data Safety form
 * has to state, and `docs/MOBILE_PLAY_STORE.md` does.
 */

const PLUGIN_STORAGE = 'SecureStorage';
const PLUGIN_BIOMETRY = 'BiometricAuthNative';

/**
 * The storage plugin prefixes keys itself in its JS wrapper; going straight to the
 * native method means the full key is ours to pick. It is spelled out here rather than
 * inheriting the plugin's default `capacitor-storage_` so a future wrapper import cannot
 * silently start reading a different entry.
 */
const VAULT_KEY = 'hydromart_session';

/** Read the stored blob, or null when there is none (a first run, or after a wipe). */
export async function vaultRead(): Promise<string | null> {
  const res = await askPlugin<{ data?: string | null }>(PLUGIN_STORAGE, 'internalGetItem', {
    prefixedKey: VAULT_KEY,
    sync: false,
  });
  return res?.data ?? null;
}

/**
 * Write the blob. Resolves when the Keystore has it, which is the whole reason this
 * returns a promise: a rotated refresh token that is only in memory when the process
 * dies is a token the server has already invalidated and the app will replay on next
 * launch — and replay is exactly what the session service's reuse detection revokes the
 * whole family for, forcing the user back through OTP.
 */
export async function vaultWrite(value: string): Promise<void> {
  await askPlugin(PLUGIN_STORAGE, 'internalSetItem', {
    prefixedKey: VAULT_KEY,
    data: value,
    sync: false,
    // iOS keychain accessibility. Ignored on Android, passed so the one code path stays
    // correct when `cap add ios` happens.
    access: 'whenUnlocked',
  });
}

export async function vaultClear(): Promise<void> {
  await askPlugin(PLUGIN_STORAGE, 'internalRemoveItem', { prefixedKey: VAULT_KEY, sync: false });
}

export type UnlockResult =
  /** The person proved they are the owner. */
  | 'ok'
  /** Nothing to prove it with: no biometry enrolled and no PIN, pattern or password. */
  | 'unavailable'
  /** They dismissed the prompt. Not a failed attempt — it proves nothing either way. */
  | 'cancelled'
  /** A real mismatch, or the OS locking biometry out after too many. */
  | 'failed';

/**
 * Codes the plugin returns that mean "the user walked away", including the fallback
 * button on iOS. None of these is evidence of an intruder, so none may ever count
 * towards destroying the stored session.
 */
const CANCELLED = new Set(['userCancel', 'appCancel', 'systemCancel', 'userFallback']);

/**
 * Codes that mean the device cannot answer the question at all. `checkBiometry` is asked
 * first and normally catches these, but enrolment can be removed between the two calls
 * and a phone that suddenly has no lock must not become a phone the user is locked out
 * of.
 */
const UNAVAILABLE = new Set([
  'biometryNotAvailable',
  'biometryNotEnrolled',
  'noDeviceCredential',
  'passcodeNotSet',
  'invalidContext',
  'notInteractive',
  'unavailable',
]);

/**
 * Ask the owner to unlock, and say what happened.
 *
 * `allowDeviceCredential` is on: a depot courier with a cracked fingerprint sensor, or a
 * phone with no sensor at all, still gets a PIN prompt, and that is a stronger gate than
 * this app had yesterday — not a weaker one. Only a device with no screen lock
 * whatsoever answers `unavailable`, and on such a device there is no secret to protect:
 * anyone holding it already has everything on it.
 */
export async function unlockDevice(reason: string): Promise<UnlockResult> {
  const info = await askPlugin<{ isAvailable?: boolean; deviceIsSecure?: boolean }>(
    PLUGIN_BIOMETRY,
    'checkBiometry',
  );
  if (!info) return 'unavailable';
  if (!info.isAvailable && !info.deviceIsSecure) return 'unavailable';

  const res = await tryPlugin<void>(PLUGIN_BIOMETRY, 'internalAuthenticate', {
    reason,
    androidTitle: 'Hydromart',
    androidSubtitle: reason,
    allowDeviceCredential: true,
    // The extra "confirm" tap after a face match buys nothing here: the next screen is
    // the app the user just opened, not a payment.
    androidConfirmationRequired: false,
  });
  if (res.ok) return 'ok';
  if (UNAVAILABLE.has(res.code)) return 'unavailable';
  return CANCELLED.has(res.code) ? 'cancelled' : 'failed';
}
