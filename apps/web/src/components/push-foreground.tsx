'use client';

import { useEffect } from 'react';

import { useToast } from '@/components/toast';
import { onPluginEvent } from '@/lib/capacitor';
import { isNativeShell } from '@/lib/platform';

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

  useEffect(() => {
    if (!isNativeShell()) return;
    return onPluginEvent(
      'PushNotifications',
      'pushNotificationReceived',
      (notification: { title?: string; body?: string }) => {
        // Either half can be absent — a data-only message has neither, and there is
        // nothing to show for one of those.
        const text = [notification?.title, notification?.body].filter(Boolean).join(' — ');
        if (text) toast(text, 'info');
      },
    );
  }, [toast]);

  return null;
}
