'use client';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { MyDepotDeposit } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

/**
 * I5 · the customer's own gallon deposit.
 *
 * Both numbers already existed and were rendered only in the depot staff console, so the
 * person whose money it is had no screen for either — not "how many gallons am I holding",
 * not "how much of my deposit is still with the depot".
 *
 * `null` and `[]` are different answers and must not look the same: `null` means
 * depot-service could not be read, and printing "you are holding nothing" there would be a
 * deposit quietly disappearing. It sits directly under the profile card rather than behind
 * a sheet, because it is money.
 */
export function GallonDepositCard() {
  const { t } = useT();
  const { data, loading } = useAsync<MyDepotDeposit[] | null>(() =>
    api.get<MyDepotDeposit[] | null>(endpoints.profile.gallonDeposit, true),
  );

  if (loading && !data) return null;

  return (
    <section className="surface rounded-[20px] border border-app p-4">
      <h2 className="text-[15px] font-extrabold">{t('customerFix.gallonDeposit.title')}</h2>
      <p className="mt-0.5 text-[12.5px] text-muted">{t('customerFix.gallonDeposit.subtitle')}</p>

      {data == null ? (
        <p className="mt-3 text-[13px] text-muted">{t('customerFix.gallonDeposit.unavailable')}</p>
      ) : data.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{t('customerFix.gallonDeposit.empty')}</p>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {data.map((d) => (
              <li
                key={d.depotId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-app px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-bold">{d.depotName}</div>
                  <div className="text-[12px] text-muted">
                    {t('customerFix.gallonDeposit.gallons', { n: d.gallonsOnLoan })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[12px] text-muted">{t('customerFix.gallonDeposit.held')}</div>
                  <div className="text-[13.5px] font-bold tabular-nums">
                    {formatIDR(d.depositHeldIdr)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[12px] text-muted">{t('customerFix.gallonDeposit.note')}</p>
        </>
      )}
    </section>
  );
}
