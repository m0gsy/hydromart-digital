'use client';

import { onPluginEvent } from './capacitor';
import { isNativeShell } from './platform';

/**
 * "The app came back to the front", and how long it had been away.
 *
 * A browser tab that is not visible is still a running page whose timers fire and whose
 * `online` events arrive. A backgrounded Android app is not: the WebView is frozen, and
 * everything the app believed when it was frozen is what it still believes when the user
 * returns — a delivery list from forty minutes ago, a queue that never noticed the signal
 * came back, a session unlocked before lunch.
 *
 * One subscription, because three unrelated things need the same moment and three
 * listeners would each have to know about the shell. `appStateChange` comes from
 * `@capacitor/app`, already installed for the back button; `visibilitychange` is the web
 * equivalent and makes this testable and useful in a browser too, where the tab being
 * hidden is at least a hint.
 *
 * Listeners are called with the number of milliseconds the app spent away, so each can
 * decide its own threshold: a queue flush is worth doing after five seconds, re-locking a
 * session is not.
 */

type ResumeListener = (awayMs: number) => void;

const listeners = new Set<ResumeListener>();
/** When the app went to the background. Null while it is in front. */
let leftAt: number | null = null;

export function onResume(fn: ResumeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function left(): void {
  leftAt ??= Date.now();
}

function returned(): void {
  const awayMs = leftAt === null ? 0 : Date.now() - leftAt;
  leftAt = null;
  // A copy, so a listener that unsubscribes itself while resuming cannot skip the next one.
  for (const fn of [...listeners]) fn(awayMs);
}

if (typeof window !== 'undefined') {
  if (isNativeShell()) {
    onPluginEvent('App', 'appStateChange', (state: { isActive?: boolean }) =>
      state?.isActive ? returned() : left(),
    );
  }
  // Registered on both: in the shell the two agree, and a WebView that stops delivering
  // `appStateChange` — which is a plugin away from being true — still has this one.
  document.addEventListener('visibilitychange', () =>
    document.visibilityState === 'visible' ? returned() : left(),
  );
}
