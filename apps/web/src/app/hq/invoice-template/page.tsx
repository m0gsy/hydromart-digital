'use client';

import { Article, Printer } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, Chip, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { INVOICE_SAMPLE_LINES } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { TaxSettings } from '@/lib/types';

// Design 24d — invoice/receipt print preview. Company identity + PPN come from the REAL
// tax settings (19f, payment-service); only the line items are sample data (no single
// order is being previewed), so the header keeps a "sample" badge.
export default function HqInvoiceTemplatePage() {
  const { t } = useT();
  const tax = useAsync<TaxSettings>(() => api.get(endpoints.tax.get, true));

  if (tax.loading) return <Skeleton className="h-96 w-full" />;
  if (tax.error) return <ErrorState message={t('hq.tax.loadError')} onRetry={tax.reload} />;

  const settings = tax.data!;
  const gross = INVOICE_SAMPLE_LINES.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const rate = settings.ppnPercent / 100;
  // "termasuk pajak": total is the gross and PPN is extracted; else PPN is added on top.
  const ppn = settings.priceIncludesTax ? Math.round(gross - gross / (1 + rate)) : Math.round(gross * rate);
  const net = settings.priceIncludesTax ? gross - ppn : gross;
  const total = settings.priceIncludesTax ? gross : gross + ppn;
  const invoiceNo = settings.invoiceFormat
    .replace('{YYYY}', '2026')
    .replace('{MM}', '07')
    .replace('{SEQ}', '0142')
    .replace('{NNNN}', '0142');

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Article}
        title={t('hq.invoiceTemplate.title')}
        subtitle={t('hq.invoiceTemplate.subtitle')}
        stub
        action={
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={16} weight="fill" />
            {t('hq.invoiceTemplate.print')}
          </Button>
        }
      />

      <Card className="mx-auto w-full max-w-2xl bg-white p-8 text-[#16282e]" elevated>
        <div className="flex items-start justify-between gap-4 border-b border-[#e9e7df] pb-5">
          <div>
            <p className="text-lg font-extrabold">{settings.companyName}</p>
            <p className="mt-1 max-w-xs text-xs text-[#64757c]">{settings.address}</p>
            <p className="mt-1 text-xs text-[#64757c]">
              {t('hq.invoiceTemplate.npwp')}: {settings.npwp || '—'}
            </p>
          </div>
          <div className="text-right">
            <Chip tone="success">{t('hq.invoiceTemplate.paid')}</Chip>
            <p className="mt-2 text-xs text-[#64757c]">{t('hq.invoiceTemplate.invoiceNo')}</p>
            <p className="font-mono text-sm font-bold">{invoiceNo}</p>
            <p className="mt-1 text-xs text-[#64757c]">{t('hq.invoiceTemplate.date')}: 16/07/2026</p>
          </div>
        </div>

        <div className="py-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[#64757c]">{t('hq.invoiceTemplate.billTo')}</p>
          <p className="mt-1 text-sm font-semibold">{t('hq.invoiceTemplate.sampleCustomer')}</p>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#e9e7df] text-left text-xs uppercase tracking-wide text-[#64757c]">
              <th className="py-2">{t('hq.invoiceTemplate.item')}</th>
              <th className="py-2 text-right">{t('hq.invoiceTemplate.qty')}</th>
              <th className="py-2 text-right">{t('hq.invoiceTemplate.price')}</th>
              <th className="py-2 text-right">{t('hq.invoiceTemplate.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {INVOICE_SAMPLE_LINES.map((l) => (
              <tr key={l.name} className="border-b border-[#f0eee6]">
                <td className="py-2.5">{l.name}</td>
                <td className="py-2.5 text-right tabular-nums">{l.qty}</td>
                <td className="py-2.5 text-right tabular-nums">
                  <Money amount={l.unitPrice} />
                </td>
                <td className="py-2.5 text-right tabular-nums font-semibold">
                  <Money amount={l.qty * l.unitPrice} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-4 flex w-full max-w-xs flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-[#64757c]">{t('hq.invoiceTemplate.subtotal')}</span>
            <Money amount={net} className="tabular-nums" />
          </div>
          <div className="flex justify-between">
            <span className="text-[#64757c]">{t('hq.invoiceTemplate.ppn', { n: settings.ppnPercent })}</span>
            <Money amount={ppn} className="tabular-nums" />
          </div>
          <div className="mt-1 flex justify-between border-t border-[#e9e7df] pt-2 text-base font-extrabold">
            <span>{t('hq.invoiceTemplate.total')}</span>
            <Money amount={total} className="tabular-nums" />
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-[#64757c]">{t('hq.invoiceTemplate.fromTax')}</p>
      </Card>
    </div>
  );
}
