'use client';

import { UsersThree } from '@phosphor-icons/react';

import { Card, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { ReferralSummary } from '@/lib/types';

/**
 * One customer's referral standing, as staff see it.
 *
 * `GET /referrals/customers/:id` is `loyaltyRead`-guarded, it was built, and no screen
 * called it — so a depot could read its own referral ROLLUP and never the person in front
 * of them, which is the row anybody actually asks about: "did this customer's invite
 * qualify?"
 *
 * Its own component rather than another block inside a 300-line page, because the page is
 * only renderable with half a dozen contexts in place and this card is not — and a card
 * about money that cannot be tested is a card nobody can change safely.
 */
export function CustomerReferralCard({ customerId }: { customerId: string }) {
  const { t } = useT();
  /*
   * Fail-soft to null, like the reseller read on the same screen. A referral card that
   * cannot load must not take the customer's name and phone number down with it — that is
   * the DEFECT-01 shape pointed the other way.
   */
  const referral = useAsync<ReferralSummary | null>(
    () =>
      api.get<ReferralSummary>(endpoints.referrals.byCustomer(customerId), true).catch(() => null),
    [customerId],
  );

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <UsersThree size={18} weight="fill" className="text-brand-500" />
        <h2 className="text-lg font-bold">{t('dashA.customerDetail.referralTitle')}</h2>
      </div>
      <Card className="p-4">
        {referral.loading ? (
          <Skeleton className="h-12 w-full" />
        ) : !referral.data ? (
          <p className="text-sm text-[color:var(--text-muted)]">
            {t('dashA.customerDetail.referralError')}
          </p>
        ) : referral.data.referredCount === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]">
            {t('dashA.customerDetail.referralEmpty')}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-[color:var(--text-muted)]">
                {t('dashA.customerDetail.referralCode')}:{' '}
              </span>
              <span className="font-mono font-semibold">{referral.data.code.code}</span>
            </span>
            <span>
              <span className="text-[color:var(--text-muted)]">
                {t('dashA.customerDetail.referralInvited')}:{' '}
              </span>
              <span className="font-semibold tabular-nums">{referral.data.referredCount}</span>
            </span>
            {/*
              Qualified is the half that pays. An invite that never qualified has earned
              nobody anything, so showing "4 invited" alone reads as reward already owed.
            */}
            <span>
              <span className="text-[color:var(--text-muted)]">
                {t('dashA.customerDetail.referralQualified')}:{' '}
              </span>
              <span className="font-semibold tabular-nums">{referral.data.qualifiedCount}</span>
            </span>
          </div>
        )}
      </Card>
    </section>
  );
}
