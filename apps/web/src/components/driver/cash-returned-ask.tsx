'use client';

import { Coins } from '@phosphor-icons/react';

import { Card } from '@/components/ui';
import { useT } from '@/lib/locale-context';

const IDR = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

/**
 * CA-4-03 — the one question that decides where already-collected cash goes.
 *
 * A courier can take the money at the door and only then find the goods are wrong, or agree
 * a new slot. Until now the delivery simply stopped being DELIVERED, and the end-of-shift
 * deposit — which counted only DELIVERED rows — stopped mentioning the money at all. No
 * shortfall, no dispute, no trace.
 *
 * Owner decision D1 (2 September 2026) is to ASK rather than assume, because both
 * assumptions cost somebody real money: assume it went back and it vanishes from the books;
 * assume the courier kept it and a courier who did the right thing gets a shortfall that can
 * be charged against their pay.
 *
 * Deliberately has NO default. Both answers are consequential, so a pre-selected one is a
 * decision made by the layout rather than by the person who was there — and the submit
 * button stays disabled until they answer. Rendered only when the server says this courier
 * is actually holding the cash (`cashHeld`), so it never appears on a prepaid order.
 */
export function CashReturnedAsk({
  amount,
  value,
  onChange,
}: {
  amount: number | null | undefined;
  value: boolean | null;
  onChange: (returned: boolean) => void;
}) {
  const { t } = useT();
  const options: { returned: boolean; label: string; hint: string }[] = [
    {
      returned: true,
      label: t('driver.cashReturned.yes'),
      hint: t('driver.cashReturned.yesHint'),
    },
    {
      returned: false,
      label: t('driver.cashReturned.no'),
      hint: t('driver.cashReturned.noHint'),
    },
  ];

  return (
    <Card className="space-y-3 border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <Coins size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-700" />
        <div>
          <p className="text-sm font-extrabold text-amber-900">
            {t('driver.cashReturned.title', { amount: IDR.format(amount ?? 0) })}
          </p>
          <p className="mt-0.5 text-[12px] text-amber-900/80">{t('driver.cashReturned.why')}</p>
        </div>
      </div>
      {/*
        A radiogroup rather than two buttons: this is one question with two answers, and a
        screen reader must hear it that way. `aria-checked` carries the state because the
        control is styled, not a native input.
      */}
      <div role="radiogroup" aria-label={t('driver.cashReturned.title', { amount: IDR.format(amount ?? 0) })} className="flex flex-col gap-2">
        {options.map((o) => (
          <button
            key={String(o.returned)}
            type="button"
            role="radio"
            aria-checked={value === o.returned}
            onClick={() => onChange(o.returned)}
            className={`min-h-11 rounded-xl px-3.5 py-2.5 text-left text-sm font-bold ${
              value === o.returned ? 'bg-amber-600 text-white' : 'bg-white text-amber-900'
            }`}
          >
            {o.label}
            <span
              className={`block text-[11px] font-semibold ${
                value === o.returned ? 'text-white/80' : 'text-amber-900/70'
              }`}
            >
              {o.hint}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
