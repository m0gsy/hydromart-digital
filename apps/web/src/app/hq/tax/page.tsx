'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Invoice } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, Field, Input, Skeleton, Toggle } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { TaxSettings } from '@/lib/types';

// Design 19f — tax & invoice settings. Real payment-service track: loads the singleton
// tax settings and saves via PUT. Feeds the invoice template (screen 24d), which reads the
// same live settings.
export default function HqTaxPage() {
  const { t } = useT();
  const { toast } = useToast();
  const loaded = useAsync<TaxSettings>(() => api.get(endpoints.tax.get, true));
  const [form, setForm] = useState<TaxSettings | null>(null);
  const [busy, setBusy] = useState(false);

  if (loaded.loading) return <Skeleton className="h-96 w-full" />;
  if (loaded.error) return <ErrorState message={t('hq.tax.loadError')} onRetry={loaded.reload} />;

  // Seed the editable form from the loaded settings once.
  const current = form ?? loaded.data!;
  const set = <K extends keyof TaxSettings>(k: K, v: TaxSettings[K]) =>
    setForm({ ...current, [k]: v });

  async function save() {
    setBusy(true);
    try {
      const saved = await api.put<TaxSettings>(
        endpoints.tax.update,
        {
          ppnPercent: current.ppnPercent,
          priceIncludesTax: current.priceIncludesTax,
          invoiceFormat: current.invoiceFormat,
          companyName: current.companyName,
          npwp: current.npwp,
          address: current.address,
        },
        true,
      );
      setForm(saved);
      toast(t('hq.tax.saved'), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.tax.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Invoice}
        title={t('hq.tax.title')}
        subtitle={t('hq.tax.subtitle')}
        action={
          <Link href="/hq/invoice-template" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800">
            {t('hq.tax.previewLink')}
            <ArrowRight size={15} weight="bold" />
          </Link>
        }
      />

      <Card className="flex flex-col gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('hq.tax.ppn')} htmlFor="ppn">
            <Input
              id="ppn"
              inputMode="numeric"
              value={String(current.ppnPercent)}
              onChange={(e) => set('ppnPercent', Number(e.target.value) || 0)}
            />
          </Field>
          <Field label={t('hq.tax.format')} htmlFor="fmt" hint={t('hq.tax.formatHint')}>
            <Input id="fmt" value={current.invoiceFormat} onChange={(e) => set('invoiceFormat', e.target.value)} />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-app p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('hq.tax.includes')}</p>
            <p className="text-xs text-muted">{t('hq.tax.includesBody')}</p>
          </div>
          <Toggle on={current.priceIncludesTax} onChange={(v) => set('priceIncludesTax', v)} label={t('hq.tax.includes')} />
        </div>

        <Field label={t('hq.tax.company')} htmlFor="co">
          <Input id="co" value={current.companyName} onChange={(e) => set('companyName', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('hq.tax.npwp')} htmlFor="npwp">
            <Input id="npwp" value={current.npwp} onChange={(e) => set('npwp', e.target.value)} />
          </Field>
          <Field label={t('hq.tax.address')} htmlFor="addr">
            <Input id="addr" value={current.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} loading={busy}>{t('hq.tax.save')}</Button>
        </div>
      </Card>
    </div>
  );
}
