'use client';

import { useEffect, useState } from 'react';

import { callPlugin, onPluginEvent } from '@/lib/capacitor';
import { isNativeShell, openExternal } from '@/lib/platform';

/**
 * Everything the app has to do because it is running inside a WebView and not a browser.
 * Renders nothing on the web, and nothing on native either unless the WebView itself is
 * too old to run the app — see below.
 *
 * Mounted once, in the root layout, because both of its jobs are global: there is one
 * hardware back button and one WebView.
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

function chromeMajor(): number | null {
  const match = /Chrome\/(\d+)/.exec(navigator.userAgent);
  return match ? Number(match[1]) : null;
}

export function NativeBridge() {
  const [webViewTooOld, setWebViewTooOld] = useState(false);

  useEffect(() => {
    if (!isNativeShell()) return;

    const major = chromeMajor();
    // A missing Chrome token means this is not the WebView we know how to judge; do not
    // lock a user out on a guess.
    if (major !== null && major < MIN_CHROME) setWebViewTooOld(true);

    return onPluginEvent('App', 'backButton', handleBack);
  }, []);

  if (!webViewTooOld) return null;
  return <WebViewTooOld />;
}

/**
 * The hardware back button, which Capacitor does not wire to anything useful by default:
 * it exits the app from the first press even with a sheet open and ten pages of history.
 *
 * Order matters and is the whole point. A sheet is what the user means by "back" while
 * one is open, and every overlay in the app already closes on Escape (`overlay.tsx`,
 * `command-palette.tsx`), so dispatching one closes whichever is on top without this
 * file needing to know they exist — including any overlay added later.
 */
function handleBack(): void {
  if (document.querySelector('[aria-modal="true"]')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return;
  }
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  // Nothing left to go back to: leave, rather than sit on a screen where the button
  // appears broken. `exitApp` finishes the activity; Android keeps the app in recents.
  callPlugin('App', 'exitApp');
}

/**
 * Deliberately styled with inline attributes and system fonts only. Tailwind is exactly
 * what is broken on the WebView this screen exists to report, so a class name here would
 * render as nothing and the user would see a blank app instead of a reason.
 */
function WebViewTooOld() {
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
      <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
        Perbarui Android System WebView
      </h1>
      <p style={{ margin: 0, maxWidth: '360px' }}>
        Aplikasi Hydromart butuh komponen WebView yang lebih baru agar tampil dengan benar. Perbarui
        lewat Play Store, lalu buka aplikasi ini lagi.
      </p>
      <button
        type="button"
        // ponytail: `market://` goes straight to the Play app. A device without Play
        // cannot have installed this app from Play either, so there is no fallback here.
        onClick={() => openExternal('market://details?id=com.google.android.webview')}
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
