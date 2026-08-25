'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useToast } from '@/components/toast';
import { callPlugin, onPluginEvent } from '@/lib/capacitor';
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
 * O4. It used to be a toast and only a toast, dismissed after 3.2 seconds — the same
 * duration as the "added to cart" pill, for "your order is on its way". The old reasoning
 * (a second notification surface to justify to Play, for a message the user is already
 * looking at) held right up until you watch someone use it: the phone is open on a
 * different screen of the same app, the pill appears in a corner and is gone, and the
 * notification that WOULD have been in the tray if the app had been closed is never in the
 * tray at all. So the same message is now posted as a real OS notification, on the SAME
 * channel FCM uses, and the toast stays for the case where it is genuinely enough.
 *
 * Posted through the runtime bridge rather than an import: a build whose plugin is missing
 * (an older APK, a web build, a local APK built without the plugin) silently keeps the old
 * toast-only behaviour instead of throwing on a module that is not there.
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
        // O4: the badge in the nav re-reads on this, so an arriving push updates the
        // count without a poll and without this component knowing where the badge is.
        window.dispatchEvent(new Event('hydromart:push-received'));
        const path = notification?.data?.url ? resolveDeepLink(notification.data.url) : null;
        toast(text, 'info', path ? () => router.push(path) : undefined);
        /*
         * The tray copy. `id` must be an int32 and must differ per message or Android
         * REPLACES the previous one — a courier with three tasks would see one. The
         * channel is the one the FCM notification messages already use, so a user who
         * muted it stays muted: a second channel would be a mute the user thought they
         * had set and had not.
         */
        callPlugin('LocalNotifications', 'schedule', {
          notifications: [
            {
              id: (Date.now() % 2_000_000_000) + 1,
              title: notification?.title ?? 'Hydromart',
              body: notification?.body ?? text,
              // The one `ensureChannel()` creates and FCM files into (`lib/push.ts`).
              channelId: 'hydromart_orders',
              extra: path ? { url: path } : undefined,
            },
          ],
        });
      },
    );
    return () => {
      offToken();
      offPush();
    };
  }, [toast, router]);

  return null;
}
