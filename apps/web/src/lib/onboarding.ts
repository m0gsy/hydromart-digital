import type { DepotAdmin } from './types';

/**
 * Which go-live steps a depot has actually completed, derived from the data — there is no
 * separate onboarding store to fall out of step with reality.
 *
 * The first three are true whenever the depot exists, and they say so: legal review, survey and
 * provisioning happen before a depot is created, so a depot that is here has cleared them. The
 * rest were not enforced by anything until the launch audit found a live depot with no
 * opening hours (its "antar sekarang" silently unavailable) and a franchise depot with no owner
 * (its ledger and commission path dead) that this checklist showed as ready.
 */
export type OnboardingStepId =
  'legal' | 'survey' | 'provision' | 'hours' | 'owner' | 'stock' | 'staff' | 'payments';

const filled = (v: string | null | undefined): boolean => (v ?? '').trim().length > 0;

export interface OnboardingSignals {
  depot: DepotAdmin | null;
  /** Inventory lines the depot holds. */
  stockLines: number;
  /** Active staff assigned to the depot. */
  staffTotal: number;
}

/** A franchise depot needs an owner; a company depot has no such step. */
export function onboardingApplies(id: OnboardingStepId, depot: DepotAdmin | null): boolean {
  return id !== 'owner' || depot?.ownershipType === 'WARALABA';
}

export function onboardingDone({
  depot,
  stockLines,
  staffTotal,
}: OnboardingSignals): Record<OnboardingStepId, boolean> {
  const exists = depot !== null;
  return {
    legal: exists,
    survey: exists,
    provision: exists,
    // {} is what a depot that never entered its hours carries; opening-hours.ts reads it as shut.
    hours: exists && Object.keys(depot.operatingHours ?? {}).length > 0,
    owner: exists && filled(depot.ownerId),
    stock: stockLines > 0,
    staff: staffTotal > 0,
    payments:
      exists && (filled(depot.paymentBankAccountNumber) || filled(depot.paymentQrisImageUrl)),
  };
}
