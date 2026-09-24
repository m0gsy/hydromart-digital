import { describe, expect, it } from 'vitest';

import { onboardingApplies, onboardingDone } from '../src/lib/onboarding';
import type { DepotAdmin } from '../src/lib/types';

const depot = (over: Partial<DepotAdmin> = {}): DepotAdmin =>
  ({
    id: 'd1',
    code: 'BKS-01',
    name: 'Depot',
    ownershipType: 'HKP',
    operatingHours: { mon: { open: '08:00', close: '21:00' } },
    ownerId: null,
    paymentBankAccountNumber: null,
    paymentQrisImageUrl: null,
    ...over,
  }) as DepotAdmin;

const signals = { stockLines: 3, staffTotal: 2 };

describe('onboardingDone', () => {
  it('marks nothing done when there is no depot', () => {
    const done = onboardingDone({ depot: null, ...signals });
    expect(done.legal).toBe(false);
    expect(done.provision).toBe(false);
    expect(done.hours).toBe(false);
    expect(done.payments).toBe(false);
  });

  it('treats a depot that exists as having cleared legal, survey and provisioning', () => {
    const done = onboardingDone({ depot: depot(), ...signals });
    expect([done.legal, done.survey, done.provision]).toEqual([true, true, true]);
  });

  it('does not count opening hours that were never entered', () => {
    expect(onboardingDone({ depot: depot({ operatingHours: {} }), ...signals }).hours).toBe(false);
    expect(onboardingDone({ depot: depot({ operatingHours: undefined }), ...signals }).hours).toBe(
      false,
    );
    expect(onboardingDone({ depot: depot(), ...signals }).hours).toBe(true);
  });

  it('needs an owner for a franchise depot, and a blank owner is not one', () => {
    expect(onboardingDone({ depot: depot({ ownerId: 'owner-1' }), ...signals }).owner).toBe(true);
    expect(onboardingDone({ depot: depot({ ownerId: null }), ...signals }).owner).toBe(false);
    expect(onboardingDone({ depot: depot({ ownerId: '  ' }), ...signals }).owner).toBe(false);
  });

  it('counts a payment destination when there is a bank account or a QRIS, and not blanks', () => {
    const none = onboardingDone({ depot: depot({ paymentBankAccountNumber: '   ' }), ...signals });
    expect(none.payments).toBe(false);
    const bank = onboardingDone({ depot: depot({ paymentBankAccountNumber: '123' }), ...signals });
    expect(bank.payments).toBe(true);
    const qris = onboardingDone({
      depot: depot({ paymentQrisImageUrl: 'https://x/qris.png' }),
      ...signals,
    });
    expect(qris.payments).toBe(true);
  });

  it('reads stock and staff from the counts it is given', () => {
    const empty = onboardingDone({ depot: depot(), stockLines: 0, staffTotal: 0 });
    expect([empty.stock, empty.staff]).toEqual([false, false]);
    const full = onboardingDone({ depot: depot(), stockLines: 1, staffTotal: 1 });
    expect([full.stock, full.staff]).toEqual([true, true]);
  });
});

describe('onboardingApplies', () => {
  it('shows the owner step for franchise depots only', () => {
    expect(onboardingApplies('owner', depot({ ownershipType: 'WARALABA' }))).toBe(true);
    expect(onboardingApplies('owner', depot({ ownershipType: 'HKP' }))).toBe(false);
    expect(onboardingApplies('owner', null)).toBe(false);
  });

  it('shows every other step for every depot', () => {
    expect(onboardingApplies('hours', depot({ ownershipType: 'HKP' }))).toBe(true);
    expect(onboardingApplies('payments', null)).toBe(true);
  });
});
