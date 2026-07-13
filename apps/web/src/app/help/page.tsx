'use client';

import { useMemo, useState } from 'react';
import {
  CaretDown,
  ChatCircleDots,
  DropHalf,
  MagnifyingGlass,
  Phone,
  Truck,
  UserGear,
  Wallet,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { useT } from '@/lib/locale-context';
import { help as helpID } from '@/lib/dictionaries/id/help';
import { help as helpEN } from '@/lib/dictionaries/en/help';

// ponytail: support number is a single placeholder constant — no per-depot CS
// routing in scope. Swap for a real hotline / wire to config when one exists.
const SUPPORT_PHONE = '+62 812-9000-0100';
const WA_LINK = `https://wa.me/${SUPPORT_PHONE.replace(/[^0-9]/g, '')}`;

const TOPIC_ICONS: Record<string, Icon> = {
  delivery: Truck,
  payment: Wallet,
  gallon: DropHalf,
  account: UserGear,
};

export default function HelpPage() {
  const { t, locale } = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  // FAQ is structured (array), so `t()` can't fetch it — pick the fragment by locale.
  const faq = (locale === 'en' ? helpEN : helpID).faq as readonly { q: string; a: string }[];
  const topics = ['delivery', 'payment', 'gallon', 'account'] as const;

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? faq
            .map((row, i) => ({ row, i }))
            .filter(({ row }) => (row.q + row.a).toLowerCase().includes(q))
        : faq.map((row, i) => ({ row, i })),
    [faq, q],
  );

  return (
    <div className="mx-auto max-w-[520px]">
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{t('help.title')}</h1>

      {/* search */}
      <label className="mt-3.5 flex h-12 items-center gap-2 rounded-[14px] border border-app surface px-4">
        <MagnifyingGlass size={17} className="text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('help.searchPlaceholder')}
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted"
          aria-label={t('help.searchPlaceholder')}
        />
      </label>

      {/* topic grid */}
      {!q && (
        <>
          <h2 className="mb-3 mt-5 text-xs font-extrabold uppercase tracking-wide text-muted">
            {t('help.topicsTitle')}
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {topics.map((key) => {
              const Ic = TOPIC_ICONS[key] ?? Truck;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setQuery(t(`help.topics.${key}`))}
                  className="flex flex-col gap-2.5 rounded-[16px] border border-app surface p-[15px] text-left transition-colors hover:border-brand-600"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                    <Ic size={20} weight="fill" className="text-brand-600" />
                  </span>
                  <span className="text-[12.5px] font-extrabold leading-tight">{t(`help.topics.${key}`)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* FAQ accordion */}
      <h2 className="mb-2.5 mt-5 text-xs font-extrabold uppercase tracking-wide text-muted">
        {t('help.faqTitle')}
      </h2>
      {filtered.length === 0 ? (
        <p className="rounded-[16px] border border-app surface px-4 py-6 text-center text-sm text-muted">
          {t('help.noResults', { q: query.trim() })}
        </p>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-app surface">
          {filtered.map(({ row, i }) => {
            const isOpen = open === i;
            return (
              <div key={i} className="border-t border-[color:var(--border-soft)] first:border-t-0">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[color:var(--surface-muted)]"
                >
                  <span className="flex-1 text-[13px] font-semibold">{row.q}</span>
                  <CaretDown
                    size={15}
                    className={`flex-shrink-0 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <p className="px-4 pb-4 text-[12.5px] leading-relaxed text-muted">{row.a}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CS contact */}
      <div className="mt-[18px] flex gap-2.5">
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[13px] bg-brand-600 text-sm font-extrabold text-on-brand transition-colors hover:bg-brand-800"
        >
          <ChatCircleDots size={17} weight="fill" />
          {t('help.chatCta')}
        </a>
        <a
          href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}
          aria-label={t('help.callAria')}
          className="flex h-[50px] w-14 items-center justify-center rounded-[13px] border border-app surface transition-colors hover:border-brand-600"
        >
          <Phone size={19} weight="fill" className="text-brand-600" />
        </a>
      </div>
    </div>
  );
}
