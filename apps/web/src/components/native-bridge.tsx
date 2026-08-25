'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { callPlugin, askPlugin, onPluginEvent } from '@/lib/capacitor';
import { resolveDeepLink } from '@/lib/deep-link';
import { persistSafeAreaInsets } from '@/lib/safe-area-persist';
import { isNativeShell, openExternal } from '@/lib/platform';

/**
 * Everything the app has to do because it is running inside a WebView and not a browser.
 * Renders nothing on the web, and nothing on native either unless the app must not be
 * allowed to continue — see the two gates below.
 *
 * Mounted once, in the root layout, because all of its jobs are global: there is one
 * hardware back button, one WebView, and one installed version.
 */

/**
 * J4. Tailwind v4 compiles to `@property`, `color-mix()` and cascade layers, none of
 * which exist before Chrome 111 — on an older WebView the app renders as unstyled HTML
 * with a working checkout hidden somewhere inside it. And the WebView version is NOT
 * tied to the Android version: it updates through the Play Store, so a phone on Android
 * 13 can be sitting on a WebView from 2020 because the user never updates anything.
 *
 * This is the one check that cannot be added later — an app already installed with a
 * broken layout has no screen left to tell the user anything on.
 */
const MIN_CHROME = 111;

const WEBVIEW_PACKAGE = 'com.google.android.webview';

/** Whether the URL this process was launched with has already been navigated to. */
let launchHandled = false;

interface Block {
  title: string;
  message: string;
  /** Play Store package the button sends the user to. */
  target: string;
  /**
   * N6: re-run the check. Only the version gate sets this — a WebView too old for the app
   * does not become new enough by asking again, but a floor that has not propagated to
   * this device's Play listing yet is exactly the case that resolves on a second look.
   */
  onRetry?: () => void;
}

// NativeBridge is mounted OUTSIDE LocaleProvider in layout.tsx, deliberately — this screen
// has to render when the app shell itself cannot. There is no translator in scope, and
// moving the bridge inside the provider to get one would make the blocking screen depend
// on the very thing it exists to survive.
// i18n-ok: title and message, for the reason above.
const WEBVIEW_BLOCK: Block = {
  title: 'Perbarui Android System WebView',
  message:
    'Aplikasi Hydromart butuh komponen WebView yang lebih baru agar tampil dengan benar. Perbarui lewat Play Store, lalu buka aplikasi ini lagi.',
  target: WEBVIEW_PACKAGE,
};

function chromeMajor(): number | null {
  const match = /Chrome\/(\d+)/.exec(navigator.userAgent);
  return match ? Number(match[1]) : null;
}

export function NativeBridge() {
  const [block, setBlock] = useState<Block | null>(null);
  // Read by the back handler, which is registered once and must never see a stale copy of
  // this. A ref rather than the state value for exactly that reason.
  const blockedRef = useRef(false);
  // J4. Whether `minimumVersionBlock()` has answered yet, and the one link waiting on that
  // answer. Refs because both are read by listeners registered once, outside React's
  // render cycle — a state value would be a stale copy there.
  const decidedRef = useRef(false);
  const heldRef = useRef<string | null>(null);
  const router = useRouter();

  // The native safe-area values do not survive a navigation in an exported build — see
  // `safe-area-persist.ts`. Re-applied before anything renders that depends on them.
  useEffect(() => persistSafeAreaInsets(), []);

  useEffect(() => {
    if (!isNativeShell()) return;

    // E2. Registered before every early return below, and before the version guard in
    // particular. It used to sit ~30 lines further down, so the blocking screen — the one
    // screen with no history and no other way out — was the one screen with no back
    // handler. Without a JS listener the App plugin navigates history if it can and
    // otherwise swallows the press: it never calls `finish()`, so the button is inert and
    // the app cannot be closed with it.
    const offBack = onPluginEvent('App', 'backButton', (event: { canGoBack?: boolean }) =>
      handleBack(event, blockedRef.current),
    );

    // Hidden before anything that can return early. `launchAutoHide` is off, so the splash
    // stays up until this runs — and the branch below deliberately returns without doing
    // anything else, which would have left an unsupported WebView staring at a splash
    // instead of at the screen explaining why it stopped. No-op on the web.
    callPlugin('SplashScreen', 'hide', { fadeOutDuration: 200 });

    const major = chromeMajor();
    // A missing Chrome token means this is not the WebView we know how to judge; do not
    // lock a user out on a guess.
    if (major !== null && major < MIN_CHROME) {
      blockedRef.current = true;
      setBlock(WEBVIEW_BLOCK);
      // No point asking the server anything: this screen is already the final answer.
      return offBack;
    }

    /*
     * J4. A link that arrives before the version verdict is HELD, not thrown away.
     *
     * `minimumVersionBlock()` is a network round trip, and every listener below is wired
     * while it is still in flight. So a blocked app used to do all of this anyway: push at
     * the deep link, land on it UNDERNEATH the blocking overlay, and — worse — set
     * `launchHandled`, which burns the launch URL for the whole process. The person updates,
     * comes back, and the link that started the whole thing is simply gone.
     *
     * Undecided and blocked are both "not now": the URL goes in `held` and is only spent
     * once the verdict says this build may serve it.
     */
    const open = (raw: string | undefined) => {
      if (!raw) return;
      if (blockedRef.current || !decidedRef.current) {
        heldRef.current = raw;
        return;
      }
      const path = resolveDeepLink(raw);
      if (!path) return;
      // Set HERE and not at the ask, so a blocked run leaves the launch URL unspent and the
      // next mount can still act on it.
      launchHandled = true;
      router.push(path);
    };

    const recheck = () => {
      void minimumVersionBlock().then((still) => {
        // N6: only a clear answer releases the screen. An unreachable gateway answers null
        // for its own reasons, and the version gate fails open everywhere else too — a
        // device that is genuinely below the floor gets the screen back on next launch.
        if (still) return;
        blockedRef.current = false;
        setBlock(null);
      });
    };

    void minimumVersionBlock().then((found) => {
      decidedRef.current = true;
      if (found) {
        blockedRef.current = true;
        setBlock({ ...found, onRetry: recheck });
        return;
      }
      const held = heldRef.current;
      heldRef.current = null;
      if (held) open(held);
    });

    // F3b, the two ways a route arrives from outside the app. An App Link is Android
    // handing over a verified `https://` URL it decided belongs to this app; the other is
    // the notification the user just tapped, carrying the destination crm-service chose
    // for that event. Both go through the same rewriting, because both can be older than
    // the routes this build ships.
    const offLink = onPluginEvent('App', 'appUrlOpen', (event: { url?: string }) =>
      open(event?.url),
    );
    const offTap = onPluginEvent(
      'PushNotifications',
      'pushNotificationActionPerformed',
      (event: { notification?: { data?: { url?: string } } }) =>
        open(event?.notification?.data?.url),
    );
    // A link that started the app from cold may have been delivered before this listener
    // existed, so the launch URL is asked for as well. `launchHandled` because
    // `getLaunchUrl()` keeps answering with it for the whole process lifetime — without
    // the flag, a remount would drag the user back to a page they had navigated away
    // from.
    if (!launchHandled) {
      void askPlugin<{ url?: string }>('App', 'getLaunchUrl').then((launch) => open(launch?.url));
    }

    return () => {
      offLink();
      offTap();
      offBack();
    };
  }, [router]);

  if (!block) return null;
  return <BlockingScreen block={block} />;
}

/**
 * F5. Ask the gateway the lowest version it will still serve, and compare it with the
 * versionCode this binary was built with.
 *
 * The gate normally returns 0 and blocks nobody. It exists so that a build with a broken
 * checkout, or one shipping a token it should not, can be switched off in the minutes it
 * takes to edit an env var — instead of waiting for every user to update on their own.
 * That switch cannot be retrofitted: only the code inside an already-installed binary can
 * enforce it, which is why this ships before the first Play upload rather than after the
 * first emergency.
 *
 * Fails OPEN, deliberately, at every step. An unreachable gateway, a missing plugin or a
 * malformed answer must never be the reason a working app refuses to start — the gate is
 * a kill switch for us, not a dependency for the user.
 *
 * `/mobile-config` is called as a literal rather than through `lib/endpoints`, where
 * `check-endpoint-contracts.mjs` would fail it for having no owning service. It has none:
 * the gateway answers it itself, like `/health`.
 */
async function minimumVersionBlock(): Promise<Block | null> {
  const info = await askPlugin<{ id?: string; build?: string }>('App', 'getInfo');
  const installed = Number(info?.build);
  if (!info?.id || !Number.isFinite(installed)) return null;

  const config = await api
    // N5: name the binary. One floor for both packages meant raising it to stop a broken
    // customer release also stopped every courier mid-delivery.
    .get<{ minVersionCode?: number; updateMessage?: string }>(
      `/mobile-config?id=${encodeURIComponent(info.id)}`,
    )
    .catch(() => null);
  const minimum = Number(config?.minVersionCode);
  if (!Number.isFinite(minimum) || installed >= minimum) return null;

  return {
    // i18n-ok: same reason as WEBVIEW_BLOCK — no LocaleProvider above this component.
    title: 'Versi aplikasi sudah usang',
    message:
      config?.updateMessage ||
      'Versi aplikasi ini sudah tidak didukung. Perbarui lewat Play Store untuk melanjutkan.',
    target: info.id,
  };
}

/**
 * The hardware back button, which Capacitor does not wire to anything useful by default:
 * it exits the app from the first press even with a sheet open and ten pages of history.
 *
 * Order matters and is the whole point. A sheet is what the user means by "back" while
 * one is open, and every overlay in the app already closes on Escape (`overlay.tsx`,
 * `command-palette.tsx`), so dispatching one closes whichever is on top without this
 * file needing to know they exist — including any overlay added later.
 *
 * `canGoBack` comes from the event and is the only correct source for the second
 * decision. `window.history.length` counts entries and never counts down, so after
 * home → detail → back the length is still 2 while the WebView is sitting on its first
 * entry: `history.back()` then does nothing at all and the button reads as broken —
 * neither navigating nor leaving, however many times it is pressed. The length is kept
 * only as the answer for a payload that did not arrive.
 */
function handleBack(event?: { canGoBack?: boolean }, blocked = false): void {
  // The blocking screen is terminal: there is nothing behind it this build is willing to
  // render, so "back" can only mean leave. `canGoBack` is deliberately ignored here —
  // going back to a page drawn by a WebView we just refused is not an exit.
  if (blocked) {
    callPlugin('App', 'exitApp');
    return;
  }
  if (document.querySelector('[aria-modal="true"]')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return;
  }
  if (event?.canGoBack ?? window.history.length > 1) {
    window.history.back();
    return;
  }
  // Nothing left to go back to: leave, rather than sit on a screen where the button
  // appears broken. `exitApp` finishes the activity; Android keeps the app in recents.
  callPlugin('App', 'exitApp');
}

/**
 * Deliberately styled with inline attributes and system fonts only. One of the two
 * things that render this screen is a WebView too old for Tailwind, so a class name here
 * would render as nothing and the user would see a blank app instead of a reason.
 */
function BlockingScreen({ block }: { block: Block }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: '32px 24px',
        background: '#ffffff',
        color: '#101828',
        font: '16px/1.5 system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>{block.title}</h1>
      <p style={{ margin: 0, maxWidth: '360px' }}>{block.message}</p>
      <button
        type="button"
        onClick={() => openExternal(`market://details?id=${block.target}`)}
        style={{
          padding: '12px 20px',
          borderRadius: '999px',
          border: 'none',
          background: '#0c97ac',
          color: '#ffffff',
          fontSize: '16px',
          fontWeight: 600,
        }}
      >
        Buka Play Store
      </button>
      {/*
        N6: this screen used to be a dead end with exactly one exit that assumes the update
        is already there to install. The reasons a device actually lands here are staged
        rollout, regional propagation and a stale Play cache — in all three the new version
        exists and this phone cannot see it yet, and the written justification for having no
        fallback answered a different case (sideloading).

        So: a web Play link for when the Play app cannot resolve `market://`, and a re-check
        that costs one request. Without the re-check the only way off this screen is to kill
        the app and hope, because the version gate runs once at launch.
      */}
      <a
        href={`https://play.google.com/store/apps/details?id=${block.target}`}
        onClick={(event) => {
          event.preventDefault();
          openExternal(`https://play.google.com/store/apps/details?id=${block.target}`);
        }}
        style={{ color: '#0c97ac', fontSize: '14px', fontWeight: 600 }}
      >
        Buka lewat browser
      </a>
      {block.onRetry && (
        <button
          type="button"
          onClick={block.onRetry}
          style={{
            padding: '10px 18px',
            borderRadius: '999px',
            border: '1px solid #d0d5dd',
            background: 'transparent',
            color: '#101828',
            fontSize: '15px',
            fontWeight: 600,
          }}
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}
