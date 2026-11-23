'use client';

import { useEffect } from 'react';

import { captureSource } from '@/lib/attribution';

/**
 * HD-8: notes the campaign code of the link a visit opened with (lib/attribution), on any
 * page. The signup and /waralaba pages note it again on their own mount, for a link the app
 * opens by navigating rather than by loading.
 */
export function SourceCapture() {
  useEffect(() => captureSource(window.location.search), []);
  return null;
}
