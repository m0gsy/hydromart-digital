'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useToast } from '@/components/toast';
import { onPluginEvent } from '@/lib/capacitor';
import { resolveDeepLink } from '@/lib/deep-link';
import { isNativeShell } from '@/lib/platform';
import { startPushTokenSync } from '@/lib/push';

/**
 * The push that arrives while the app is open, which nothing else draws.
 *
 * Android renders the system tray notification for an FCM `notification` message only
 * when the app is in the background or dead. In the foreground the message still arrives
 * — the plugin emits `pushNotificationReceived` — and then nothing happens at all. So the
 * one person guaranteed to miss "your order is on its way" is the one holding the phone
 * with the app open, and a courier watching their task list is the one who misses the
 * broadcast. The row is stored server-side either way, so this is lateness, not loss;
 * it is still the wrong behaviour.
 *
 * A toast rather than a locally-scheduled notification: `@capacitor/local-notifications`
 * would be a new plugin and a second notification surface to justify to Play, for a
 * message the user is already looking at the screen for.
 *
 * Mounted inside `<ToastProvider>` rather than folded into `native-bridge.tsx`, which
 * sits outside every provider on purpose — its blocking screen has to render on a WebView
 * too old to be trusted with the rest of the tree.
 */
export function PushForeground() {
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!isNativeShell()) return;
    // E4. One `registration` listener that outlives the first handshake, so a rotated FCM
    // token is re-registered instead of silently ending push. Mounted here because this
    // component already exists for the life of the app and is already native-only.
    const offToken = startPushTokenSync();
    const offPush = onPluginEvent(
      'PushNotifications',
      'pushNotificationReceived',
      (notification: { title?: string; body?: string; data?: { url?: string } }) => {
        // Either half can be absent — a data-only message has neither, and there is
        // nothing to show for one of those.
        const text = [notification?.title, notification?.body].filter(Boolean).join(' — ');
        if (!text) return;
        // The destination crm-service chose for this event, through the same rewriting a
        // tapped tray notification goes through — which is also what rejects a URL that
        // is not ours. A payload that points nowhere gives a plain pill: a toast that
        // looks pressable and does nothing is worse than one that plainly is not.
        const path = notification?.data?.url ? resolveDeepLink(notification.data.url) : null;
        toast(text, 'info', path ? () => router.push(path) : undefined);
      },
    );
    return () => {
      offToken();
      offPush();
    };
  }, [toast, router]);

  return null;
}
