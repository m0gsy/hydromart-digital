'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

import { captureSource } from '@/lib/attribution';

function Capture() {
  const query = useSearchParams().toString();
  useEffect(() => captureSource(query ? `?${query}` : ''), [query]);
  return null;
}

/**
 * HD-8: notes the campaign code of the link a page was opened by (lib/attribution): on the
 * first load and whenever the query changes after it, because the app shell never remounts and
 * an in-app link or a deep link (onto the same screen too) arrives as a navigation. Its own
 * Suspense boundary: useSearchParams needs one in the static export, and this one renders
 * nothing, so nothing else waits on it.
 */
export function SourceCapture() {
  return (
    <Suspense fallback={null}>
      <Capture />
    </Suspense>
  );
}
