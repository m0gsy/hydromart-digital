'use client';

import type { AnchorHTMLAttributes } from 'react';

import { openExternal } from '@/lib/platform';

/**
 * An anchor that leaves the app: a map pin, `tel:`, a `wa.me` chat, an uploaded receipt.
 *
 * Renders exactly the anchor these places already had, so nothing about the web changes.
 * The point is that the WebView's two failure modes now have one place to be fixed:
 * `target="_blank"` there either does nothing or replaces the app's own view with no way
 * back, and `tel:`/`wa.me` are schemes it does not handle at all. `openExternal` returns
 * false on the web, so the browser's own default is what runs.
 *
 * `_blank` is only set for http(s) — a dialler or a chat app should not be asked to open
 * in a tab.
 */
export function ExternalLink({
  href,
  children,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const opensTab = /^https?:/i.test(href);

  return (
    <a
      {...rest}
      href={href}
      {...(opensTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={(event) => {
        if (openExternal(href)) event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
