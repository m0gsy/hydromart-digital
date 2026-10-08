import type { PromoRule } from '@/lib/types';

/**
 * Editing an existing rule must preserve its OWN depotId (never the console's currently
 * active depot, which a multi-depot-scoped caller could have pointed anywhere) — only a
 * brand-new rule defaults to the active depot. Lives outside the page file because a Next.js
 * `page.tsx` may not export anything but its default component; it is a separate function so
 * this one branch, which already regressed once (silently moving a rule between depots on
 * save), has a test that doesn't need to render the page.
 */
export function effectiveDepotIdFor(
  rule: PromoRule | null,
  activeDepotId: string | null,
): string | null {
  return rule ? rule.depotId : activeDepotId;
}
