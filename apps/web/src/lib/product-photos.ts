'use client';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Product, Recommendation } from '@/lib/types';

/**
 * The CATALOGUE entries behind a handful of recommendations, in ONE call.
 *
 * A `Recommendation` carries no image — recommendation-service mirrors name/sku/unit only
 * — so every surface that draws recommendation cards has to ask the catalogue for the
 * photos of the cards it is about to draw. The home rail learned that; the product-detail
 * "sering dibeli bersama" row was a copy taken before it did, and drew the placeholder
 * drop unconditionally, so an uploaded photo could never appear there (H1).
 *
 * Two rules are the whole reason this is shared rather than pasted a second time:
 *   - one request for the whole group, never one per card, and
 *   - a failure costs the enrichment and nothing else — the caller still draws its cards
 *     from what the recommendation itself carries.
 *
 * It returns the whole product, not just the photo, and that is the fix for a second bug:
 * recommendation-service mirrors a product's NAME from the order item that last bought it,
 * and an order item is a snapshot of what the catalogue said on the day of the sale. Rename
 * a product and the rails keep the old name until somebody buys it again — so "Beli lagi"
 * and "Sering dibeli bersama" disagreed with the product page they link to.
 *
 * The catalogue read was already happening for the image. Taking the name from the same
 * answer costs nothing and cannot drift.
 */
export function useRecommendationProducts(
  recommendations: Recommendation[] | null | undefined,
): Map<string, Product> {
  const ids = (recommendations ?? []).map((r) => r.productId).join(',');
  const { data } = useAsync<Product[]>(
    () => (ids ? api.getCached<Product[]>(endpoints.products.batch(ids.split(','))) : Promise.resolve([])),
    [ids],
  );
  return new Map((data ?? []).map((p) => [p.id, p]));
}
