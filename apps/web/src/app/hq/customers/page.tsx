'use client';

import { useState } from 'react';
import { UserCircle } from '@phosphor-icons/react';

import { Button, Card, Input, Money } from '@/components/ui';
import { useToast } from '@/components/toast';
import { StubBadge, stubCustomerLifetimeValue } from '@/lib/hq/stubs';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { Customer } from '@/lib/types';

// Design 17e — Customer 360. The phone lookup + profile are real (auth.customerLookup).
// Loyalty / recent-orders / LTV have no cross-customer endpoint → badged stubs.
export default function HqCustomersPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup() {
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    setCustomer(null);
    try {
      const c = await api.get<Customer>(endpoints.auth.customerLookup(phone.trim()), true);
      setCustomer(c);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? t('hq.customers.notFound') : (err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <UserCircle size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.customers.title')}</h1>
          <p className="text-sm text-muted">{t('hq.customers.subtitle')}</p>
        </div>
      </div>

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
                <dt className="flex items-center gap-1.5 text-xs text-muted">
                  {t('hq.customers.ltv')}
                  <StubBadge />
                </dt>
                <dd className="font-semibold">
                  <Money amount={stubCustomerLifetimeValue(customer.id)} />
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2 border-t border-app pt-3">
              <Button variant="secondary" onClick={() => toast(t('hq.customers.gavePoints', { name: customer.fullName || customer.phone }), 'success')}>
                {t('hq.customers.givePoints')}
              </Button>
              <a
                href={`tel:${customer.phone}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-app px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-brand-50"
              >
                {t('hq.customers.contact')}
              </a>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="flex flex-col gap-2 p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                {t('hq.customers.loyalty')}
                <StubBadge />
              </h2>
              <p className="text-sm text-muted">{t('hq.customers.loyaltyStub')}</p>
            </Card>
            <Card className="flex flex-col gap-2 p-5">
              <h2 className="flex items-center gap-2 font-semibold">
                {t('hq.customers.recentOrders')}
                <StubBadge />
              </h2>
              <p className="text-sm text-muted">{t('hq.customers.recentStub')}</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
