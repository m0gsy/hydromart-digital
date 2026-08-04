'use client';

import { useState, type ImgHTMLAttributes } from 'react';

/**
 * Audit F-11: remote images were plain `<img>` with no loading hint, no intrinsic
 * size and no error handling — including the product-detail hero, which is the LCP
 * element on the busiest customer screen. Off-screen catalogue images downloaded
 * eagerly, every one of them reserved zero space (so the page jumped as they landed),
 * and a dead URL rendered the browser's broken-image glyph inside the card.
 *
 * Why not `next/image`: it needs `images.remotePatterns`, and product/QRIS/avatar URLs
 * come from an object-storage host that is configured per environment. The only pattern
 * that would cover every deployment is a wildcard host, which turns Next's image
 * optimiser into an open proxy for arbitrary remote URLs. A plain element with the
 * right attributes gets the lazy-loading, the reserved box and the graceful failure
 * without opening that door.
 */
export function RemoteImage({
  src,
  alt,
  /** Set on the LCP element only — it opts out of lazy loading and asks for priority. */
  priority = false,
  /** Intrinsic box, in CSS pixels, used to reserve layout space before the bytes land. */
  width,
  height,
  fallback = null,
  ...rest
}: {
  src: string | null | undefined;
  alt: string;
  priority?: boolean;
  width?: number;
  height?: number;
  fallback?: React.ReactNode;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'width' | 'height'>) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      onError={() => setBroken(true)}
      {...rest}
    />
  );
}
