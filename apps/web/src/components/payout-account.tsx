'use client';

import { useState } from 'react';

import { Button, Card, Field, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { PayoutBankAccount } from '@/lib/types';

/**
 * PYO-3 (owner decision 2026-09-17) — the payout destination on file.
 *
 * Both cash-out screens used to take a bank account typed into the withdrawal itself: the
 * courier typed one on every request, and the franchise owner's screen posted whatever the
 * depot's payment settings happened to hold. Nobody checked either. One account per person
 * now, registered here and verified by head office; the withdrawal carries an amount only.
 *
 * Shared by the courier and the owner screen because it is the same account and the same
 * route — `payout/bank-account` is self-scoped, so each caller sees exactly their own.
 */
export function PayoutAccountCard({ onChange }: { onChange?: () => void }): React.ReactElement {
  const { t } = useT();
  const { toast } = useToast();
  const account = useAsync<PayoutBankAccount | null>(
    () => api.get(endpoints.payout.bankAccount, true),
    [],
  );
  const [editing, setEditing] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [busy, setBusy] = useState(false);

  const current = account.data ?? null;
  const showForm = editing || !current;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api.put(
        endpoints.payout.bankAccount,
        { bankName: bankName.trim(), accountNumber: accountNumber.trim(), accountHolder: accountHolder.trim() },
        true,
      );
      toast(t('opsFix.payoutAccount.saved'), 'success');
      setEditing(false);
      account.reload();
      onChange?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div>
        <div className="text-sm font-extrabold">{t('opsFix.payoutAccount.title')}</div>
        <p className="mt-1 text-xs text-muted">{t('opsFix.payoutAccount.hint')}</p>
      </div>

      {account.loading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <>
          {current && (
            <div className="rounded-xl border border-app p-3 text-sm">
              <div className="font-semibold">
                {current.bankName} · {current.accountNumber}
              </div>
              <div className="text-xs text-muted">{current.accountHolder}</div>
              <div className="mt-1 text-xs font-bold">
                {current.status === 'VERIFIED'
                  ? t('opsFix.payoutAccount.verified')
                  : current.status === 'PENDING'
                    ? t('opsFix.payoutAccount.pending')
                    : t('opsFix.payoutAccount.rejected', {
                        reason: current.rejectedReason ?? t('opsFix.payoutAccount.noReason'),
                      })}
              </div>
            </div>
          )}
          {!current && !editing && (
            <p className="text-sm text-muted">{t('opsFix.payoutAccount.none')}</p>
          )}

          {showForm ? (
            <div className="space-y-3">
              <Field label={t('opsFix.payoutAccount.bank')} htmlFor="payout-bank">
                <Input id="payout-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={60} />
              </Field>
              <Field label={t('opsFix.payoutAccount.number')} htmlFor="payout-number">
                <Input
                  id="payout-number"
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/[^0-9 -]/g, ''))}
                  maxLength={30}
                />
              </Field>
              <Field label={t('opsFix.payoutAccount.holder')} htmlFor="payout-holder">
                <Input
                  id="payout-holder"
                  value={accountHolder}
                  onChange={(e) => setAccountHolder(e.target.value)}
                  maxLength={120}
                />
              </Field>
              <Button
                loading={busy}
                disabled={bankName.trim().length < 2 || accountNumber.trim().length < 6 || accountHolder.trim().length < 2}
                onClick={save}
                className="w-full"
              >
                {t('opsFix.payoutAccount.save')}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setEditing(true)} className="w-full">
              {t('opsFix.payoutAccount.replace')}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

/** PYO-3: whether this person may cash out at all — a verified account is the gate. */
export function useVerifiedPayoutAccount(): { verified: boolean; loading: boolean; reload: () => void } {
  const account = useAsync<PayoutBankAccount | null>(
    () => api.get(endpoints.payout.bankAccount, true),
    [],
  );
  return {
    verified: account.data?.status === 'VERIFIED',
    loading: account.loading,
    reload: account.reload,
  };
}
