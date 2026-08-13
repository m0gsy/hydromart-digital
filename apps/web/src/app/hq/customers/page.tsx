'use client';

import { useState } from 'react';
import { UserCircle } from '@phosphor-icons/react';

import { ExternalLink } from '@/components/external-link';
import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, Field, Input, Money } from '@/components/ui';
import { Sheet } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { Customer, CustomerSummary, LoyaltyAccount } from '@/lib/types';

// Design 17e — Customer 360. The phone lookup + profile are real (auth.customerLookup);
// LTV + recent orders are real (order-service reports.customer); loyalty tier + points are
// real (loyalty-service GET loyalty/customers/:id).
//
// "Beri poin" used to toast that points had been given and move nothing. It now posts the
// staff correction loyalty-service already exposes — which is why it asks for an amount and
// a reason instead of being one click: the ledger requires both, and a points movement
// nobody can explain three months later is not a correction.
export default function HqCustomersPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [granting, setGranting] = useState(false);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);

  async function lookup() {
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    setCustomer(null);
    setSummary(null);
    setLoyalty(null);
    try {
      const c = await api.get<Customer>(endpoints.auth.customerLookup(phone.trim()), true);
      setCustomer(c);
      // Best-effort: a customer with no orders (or no loyalty account) still shows the profile.
      try {
        setSummary(await api.get<CustomerSummary>(endpoints.reports.customer(c.id), true));
      } catch {
        setSummary(null);
      }
      try {
        setLoyalty(await api.get<LoyaltyAccount>(endpoints.loyalty.byCustomer(c.id), true));
      } catch {
        setLoyalty(null);
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? t('hq.customers.notFound') : (err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function grantPoints() {
    const delta = Number(points);
    // The DTO refuses zero server-side; catching it here keeps the sheet open on the
    // field the operator has to fix instead of bouncing them off a 400.
    if (!customer || !Number.isInteger(delta) || delta === 0) {
      return toast(t('hq.customers.pointsInvalid'), 'error');
    }
    if (!reason.trim()) return toast(t('hq.customers.reasonRequired'), 'error');
    setGrantBusy(true);
    try {
      const updated = await api.post<LoyaltyAccount>(
        endpoints.loyalty.adjust,
        { customerId: customer.id, points: delta, reason: reason.trim() },
        true,
      );
      // The response IS the new balance, so the card stops showing the old one without a
      // second read that could disagree with what was just written.
      setLoyalty(updated);
      toast(t('hq.customers.gavePoints', { name: customer.fullName || customer.phone }), 'success');
      setGranting(false);
      setPoints('');
      setReason('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.customers.givePointsError'), 'error');
    } finally {
      setGrantBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <HqPageHeader icon={UserCircle} title={t('hq.customers.title')} subtitle={t('hq.customers.subtitle')} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup();
        }}
        className="flex gap-2"
      >
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('hq.customers.lookupPh')}
          inputMode="tel"
        />
        <Button type="submit" loading={busy}>
          {t('hq.customers.lookup')}
        </Button>
      </form>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {!customer && !error && <p className="py-4 text-center text-sm text-muted">{t('hq.customers.prompt')}</p>}

      {customer && (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{t('hq.customers.profile')}</h2>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-800">
                {t(`hq.roles.${customer.role}`)}
              </span>
            </div>
            <p className="text-lg font-bold">{customer.fullName || customer.phone}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted">{t('hq.customers.email')}</dt>
                <dd>{customer.email || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('hq.customers.joined')}</dt>
                <dd>{formatDateTime(customer.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('hq.customers.ltv')}</dt>
                <dd className="font-semibold">
                  <Money amount={summary?.revenue ?? 0} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t('hq.customers.orderCount')}</dt>
                <dd className="font-semibold tabular-nums">{summary?.orderCount ?? 0}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2 border-t border-app pt-3">
              <Button variant="secondary" onClick={() => setGranting(true)}>
                {t('hq.customers.givePoints')}
              </Button>
              <ExternalLink
                href={`tel:${customer.phone}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-app px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-brand-50"
              >
                {t('hq.customers.contact')}
              </ExternalLink>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="flex flex-col gap-2 p-5">
              <h2 className="font-semibold">{t('hq.customers.loyalty')}</h2>
              {loyalty ? (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted">{t('hq.customers.loyaltyTier')}</dt>
                    <dd className="font-bold text-brand-700">{loyalty.tier}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('hq.customers.loyaltyPoints')}</dt>
                    <dd className="font-semibold tabular-nums">{loyalty.pointsBalance.toLocaleString('id-ID')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('hq.customers.loyaltyLifetime')}</dt>
                    <dd className="font-semibold tabular-nums">{loyalty.lifetimePoints.toLocaleString('id-ID')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('hq.customers.loyaltyDiscount')}</dt>
                    <dd className="font-semibold tabular-nums">{Math.round(loyalty.discountRate * 100)}%</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-muted">{t('hq.customers.loyaltyNone')}</p>
              )}
            </Card>
            <Card className="flex flex-col gap-2 p-5">
              <h2 className="font-semibold">{t('hq.customers.recentOrders')}</h2>
              {summary && summary.recentOrders.length > 0 ? (
                <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                  {summary.recentOrders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{o.orderNumber}</p>
                        <p className="text-xs text-muted">{formatDateTime(o.createdAt)}</p>
                      </div>
                      <Money amount={o.total} className="shrink-0 font-semibold" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('hq.customers.noOrders')}</p>
              )}
            </Card>
          </div>
        </div>
      )}

      <Sheet open={granting} onClose={() => setGranting(false)} title={t('hq.customers.givePoints')}>
        <div className="flex flex-col gap-4">
          <Field label={t('hq.customers.pointsLabel')} htmlFor="pt-amount" hint={t('hq.customers.pointsHint')}>
            <Input
              id="pt-amount"
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="100"
            />
          </Field>
          <Field label={t('hq.customers.reasonLabel')} htmlFor="pt-reason">
            <Input
              id="pt-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('hq.customers.reasonPlaceholder')}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setGranting(false)} disabled={grantBusy}>
              {t('hq.common.cancel')}
            </Button>
            <Button onClick={grantPoints} loading={grantBusy}>
              {t('hq.customers.givePoints')}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
