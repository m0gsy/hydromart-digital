// @vitest-environment jsdom
//
// `GET /referrals/customers/:id` is a staff read of ONE customer's referral standing. It is
// `loyaltyRead`-guarded, it was built, and no screen called it — so a depot could see its
// own referral ROLLUP and never the person in front of them, which is the row anybody
// actually asks about: "did this customer's invite qualify?"
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get }, ApiError: class extends Error {} }));

import { LocaleProvider } from '@/lib/locale-context';
import { CustomerReferralCard } from '@/components/dashboard/customer-referral-card';

const REFERRAL = {
  code: { code: 'BUDI1234', customerId: 'cust-1' },
  referrals: [],
  referredCount: 4,
  qualifiedCount: 2,
  pointsEarned: 500,
  total: 4,
  page: 1,
  limit: 10,
};

beforeEach(() => get.mockReset().mockResolvedValue(REFERRAL));
afterEach(() => vi.clearAllMocks());

const show = (id = 'cust-1') =>
  render(<CustomerReferralCard customerId={id} />, { wrapper: LocaleProvider });

describe('CustomerReferralCard', () => {
  it('reads THIS customer’s referrals, not the depot rollup', async () => {
    show();
    expect(await screen.findByText('BUDI1234')).toBeTruthy();
    expect(get.mock.calls.some((c) => String(c[0]).includes('/referrals/customers/cust-1'))).toBe(
      true,
    );
    expect(get.mock.calls.some((c) => String(c[0]).includes('depot-summary'))).toBe(false);
  });

  /*
   * Qualified is the half that pays. An invite that never qualified has earned nobody
   * anything, so showing "4 invited" alone reads as reward already owed.
   */
  it('shows qualified separately from invited', async () => {
    show();
    expect(await screen.findByText('Diundang:')).toBeTruthy();
    expect(await screen.findByText('Memenuhi syarat:')).toBeTruthy();
    expect(await screen.findByText('4')).toBeTruthy();
    expect(await screen.findByText('2')).toBeTruthy();
  });

  it('says so when the customer has invited nobody', async () => {
    get.mockResolvedValue({ ...REFERRAL, referredCount: 0, qualifiedCount: 0 });
    show();
    expect(
      await screen.findByText('Pelanggan ini belum pernah mengundang siapa pun.'),
    ).toBeTruthy();
  });

  /*
   * Fail-soft, and it must SAY so.
   *
   * The component turns a failed read into `null` (`.catch(() => null)`) so a
   * referral-service outage cannot take the customer's name and phone number down with it.
   * What matters after that is what `null` RENDERS: a blank card reads as "no referrals",
   * which is a different fact from "we could not find out" — the DEFECT-01 shape.
   *
   * Asserted on the null, not on a rejected promise: vitest fails a test on the stored
   * rejection during cleanup no matter which handler saw it first, and `.catch` turning a
   * rejection into null is JavaScript, not this component's behaviour.
   */
  it('reports a failed read instead of rendering it as zero', async () => {
    get.mockResolvedValue(null);
    show();
    expect(await screen.findByText('Gagal membaca data referral.')).toBeTruthy();
    // And specifically NOT the empty-state copy, which would be a claim about the customer.
    expect(screen.queryByText('Pelanggan ini belum pernah mengundang siapa pun.')).toBeNull();
  });
});
