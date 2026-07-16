'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Invoice } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, Field, Input, Toggle } from '@/components/ui';
import { useToast } from '@/components/toast';
import { TAX_SETTINGS_DEFAULT, type TaxSettings } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 19f — tax & invoice settings. No billing-config endpoint, so settings are local
// state; save just toasts. Feeds the invoice template (screen 24d), which reads the same
// TAX_SETTINGS_DEFAULT.
export default function HqTaxPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [form, setForm] = useState<TaxSettings>(TAX_SETTINGS_DEFAULT);
  const set = <K extends keyof TaxSettings>(k: K, v: TaxSettings[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Invoice}
        title={t('hq.tax.title')}
        subtitle={t('hq.tax.subtitle')}
        stub
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
              value={String(form.ppnPercent)}
              onChange={(e) => set('ppnPercent', Number(e.target.value) || 0)}
            />
          </Field>
          <Field label={t('hq.tax.format')} htmlFor="fmt" hint={t('hq.tax.formatHint')}>
            <Input id="fmt" value={form.invoiceFormat} onChange={(e) => set('invoiceFormat', e.target.value)} />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-app p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('hq.tax.includes')}</p>
            <p className="text-xs text-muted">{t('hq.tax.includesBody')}</p>
          </div>
          <Toggle on={form.priceIncludesTax} onChange={(v) => set('priceIncludesTax', v)} label={t('hq.tax.includes')} />
        </div>

        <Field label={t('hq.tax.company')} htmlFor="co">
          <Input id="co" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('hq.tax.npwp')} htmlFor="npwp">
            <Input id="npwp" value={form.npwp} onChange={(e) => set('npwp', e.target.value)} />
          </Field>
          <Field label={t('hq.tax.address')} htmlFor="addr">
            <Input id="addr" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => toast(t('hq.tax.saved'), 'success')}>{t('hq.tax.save')}</Button>
        </div>
      </Card>
    </div>
  );
}
