'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { callPlugin, askPlugin, onPluginEvent } from '@/lib/capacitor';
import { resolveDeepLink } from '@/lib/deep-link';
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
}

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
  const router = useRouter();

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

    void minimumVersionBlock().then((found) => {
      if (found) {
        blockedRef.current = true;
        setBlock(found);
      }
    });

    const open = (raw: string | undefined) => {
      const path = raw ? resolveDeepLink(raw) : null;
      if (path) router.push(path);
    };

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
      launchHandled = true;
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
    .get<{ minVersionCode?: number; updateMessage?: string }>('/mobile-config')
    .catch(() => null);
  const minimum = Number(config?.minVersionCode);
  if (!Number.isFinite(minimum) || installed >= minimum) return null;

  return {
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
        // ponytail: `market://` goes straight to the Play app. A device without Play
        // cannot have installed this app from Play either, so there is no fallback here.
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
    </div>
  );
}
