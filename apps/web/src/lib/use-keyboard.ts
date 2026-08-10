'use client';

import { useEffect, useState } from 'react';

import { onPluginEvent } from '@/lib/capacitor';
import { isNativeShell } from '@/lib/platform';

/**
 * Whether the soft keyboard is up, on native only.
 *
 * Android shrinks the WebView for the keyboard, which leaves anything pinned to the bottom
 * of the viewport sitting directly on top of it — covering the field being typed into. Two
 * different pieces of chrome have that problem (the tab bar, and any sticky action bar), so
 * the answer lives here rather than inside whichever one hit it first.
 *
 * `willShow`/`didHide` rather than one pair or the other: reacting to the announcement keeps
 * the chrome from being caught by the keyboard on its way up, and waiting for the keyboard to
 * be fully gone before restoring it keeps the chrome from flashing back into the closing
 * animation.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isNativeShell()) return;
    const offShow = onPluginEvent('Keyboard', 'keyboardWillShow', () => setOpen(true));
    const offHide = onPluginEvent('Keyboard', 'keyboardDidHide', () => setOpen(false));
    return () => {
      offShow();
      offHide();
    };
  }, []);
  return open;
}
