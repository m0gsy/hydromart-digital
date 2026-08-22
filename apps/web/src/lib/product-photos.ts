'use client';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Product, Recommendation } from '@/lib/types';

/**
 * Photos for a handful of recommendations, in ONE call.
 *
 * A `Recommendation` carries no image — recommendation-service mirrors name/sku/unit only
 * — so every surface that draws recommendation cards has to ask the catalogue for the
 * photos of the cards it is about to draw. The home rail learned that; the product-detail
 * "sering dibeli bersama" row was a copy taken before it did, and drew the placeholder
 * drop unconditionally, so an uploaded photo could never appear there (H1).
 *
 * Two rules are the whole reason this is shared rather than pasted a second time:
 *   - one request for the whole group, never one per card, and
 *   - a failure costs the photos and nothing else — the caller still draws its cards,
 *     falling back to the placeholder they used to always show.
 */
export function useRecommendationPhotos(
  recommendations: Recommendation[] | null | undefined,
): Map<string, string | null | undefined> {
  const ids = (recommendations ?? []).map((r) => r.productId).join(',');
  const { data } = useAsync<Product[]>(
    () => (ids ? api.getCached<Product[]>(endpoints.products.batch(ids.split(','))) : Promise.resolve([])),
    [ids],
  );
  return new Map((data ?? []).map((p) => [p.id, p.imageUrl]));
}
