'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Buildings,
  CaretUpDown,
  CheckCircle,
  ShieldCheck,
  Storefront,
} from '@phosphor-icons/react';
import { ConsoleSignOut } from '@/components/console-sign-out';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { useOpsUnreadCount } from '@/lib/unread';
import { canViewOpsNotifications } from '@/lib/roles';
import { deepest, normalisePath } from '@/lib/screen-chrome';
import { GROUPS } from '@/lib/ops-nav';

// B2: exported for the phone sheet. A depot-scoped console whose switcher only exists on
// desktop is a console a depot manager cannot re-scope from the floor.
export function DepotSwitcher() {
  const { depots, selectedId, selected, setSelected } = useDepot();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const scoped = selectedId != null && selected != null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors ' +
          (scoped ? 'border-brand-600 bg-brand-50' : 'border-app hover:border-brand-600')
        }
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-brand-50">
          {scoped ? (
            <Storefront size={16} weight="fill" className="text-brand-600" />
          ) : (
            <Buildings size={16} weight="fill" className="text-brand-600" />
          )}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12.5px] font-extrabold">
            {scoped ? selected.name : t('ops.switcher.all')}
          </span>
          <span className="block truncate text-[10.5px] text-muted">
            {scoped
              ? `${selected.code} · ${t('ops.switcher.activeContext')}`
              : t('ops.switcher.locations', { n: depots.length })}
          </span>
        </span>
        <CaretUpDown size={14} className={scoped ? 'text-brand-600' : 'text-muted'} />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-20 rounded-2xl border border-app surface p-1.5 shadow-lift">
          <SwitcherRow
            active={selectedId == null}
            title={t('ops.switcher.all')}
            meta={t('ops.switcher.combined', { n: depots.length })}
            onClick={() => {
              setSelected(null);
              setOpen(false);
            }}
          />
          {depots.map((d) => (
            <SwitcherRow
              key={d.id}
              active={selectedId === d.id}
              title={d.name}
              meta={`${d.code} · ${d.city}`}
              onClick={() => {
                setSelected(d.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SwitcherRow({
  active,
  title,
  meta,
  onClick,
}: {
  active: boolean;
  title: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ' +
        (active ? 'bg-brand-50' : 'hover:bg-[color:var(--surface-soft)]')
      }
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50">
        <Buildings size={14} weight="fill" className="text-brand-600" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[12.5px] font-semibold">{title}</span>
        <span className="block truncate text-[10.5px] text-muted">{meta}</span>
      </span>
      {active && <CheckCircle size={17} weight="fill" className="text-brand-600" />}
    </button>
  );
}

export function OpsRail() {
  const { customer } = useAuth();
  const { t, locale, setLocale } = useT();
  // The APK export runs with `trailingSlash: true`: a path with or without its final slash is one screen.
  const pathname = normalisePath(usePathname() ?? '');
  const role = customer?.role;
  // O4: only for roles that can see the ops feed at all — asking as anyone else is a 403
  // on every page load for a badge that must never appear.
  const opsUnread = useOpsUnreadCount(canViewOpsNotifications(role));

  // One current row: `/dashboard/franchise/attendance` lights that row, not its parent too.
  const current = deepest(
    GROUPS.flatMap((g) => g.items).filter((i) => i.show(role)),
    pathname,
    '/dashboard',
  )?.href;
  const isActive = (href: string) => href === current;

  return (
    <aside className="surface sticky top-0 hidden h-dvh w-[242px] shrink-0 flex-col overflow-y-auto border-r border-app px-3.5 py-4 lg:flex">
      <DepotSwitcher />

      <nav className="mt-3.5 flex flex-col gap-px">
        {GROUPS.map((group) => {
          const items = group.items.filter((i) => i.show(role));
          if (items.length === 0) return null;
          return (
            <div key={group.headKey}>
              <p className="px-3 pb-1.5 pt-3.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                {t(`ops.groups.${group.headKey}`)}
              </p>
              {items.map((item) => {
                const on = isActive(item.href);
                const Ic = item.icon;
                return (
                  <Link
                    aria-current={on ? 'page' : undefined}
                    key={item.href}
                    href={item.href}
                    className={
                      'flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] transition-colors ' +
                      (on
                        ? 'bg-brand-50 font-extrabold text-brand-800'
                        : 'font-semibold text-muted hover:bg-[color:var(--surface-soft)]')
                    }
                  >
                    <Ic
                      size={18}
                      weight="fill"
                      className={on ? 'text-brand-600' : 'text-[color:var(--text-muted)]'}
                    />
                    <span className="flex-1">{t(`ops.nav.${item.labelKey}`)}</span>
                    {/*
                      O4: the ops half of the unread badge. An operational alert has always
                      had a screen and never had a way of announcing itself — low stock and
                      a courier incident sat in a feed until somebody happened to open it.
                    */}
                    {item.labelKey === 'notifications' && opsUnread > 0 && (
                      <span className="min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-extrabold leading-[18px] text-white">
                        {opsUnread > 9 ? '9+' : opsUnread}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-2">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-xs font-medium text-muted">{t('ops.language')}</span>
          <div className="flex overflow-hidden rounded-full border border-app text-[11px] font-bold">
            {(['id', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={locale === l}
                className={`px-2.5 py-1 uppercase transition-colors ${
                  locale === l
                    ? 'bg-brand-600 text-on-brand'
                    : 'text-muted hover:bg-[color:var(--surface-soft)]'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {role && (
          <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
            <ShieldCheck size={15} className="text-brand-600" />
            {t('ops.role')}:{' '}
            <strong className="text-[color:var(--text)]">
              {t(`ops.roles.${role}`) === `ops.roles.${role}` ? role : t(`ops.roles.${role}`)}
            </strong>
          </div>
        )}
        {/*
         * CA-2-61: the way out of the depot console.
         *
         * The only exit was the `/dashboard/profile` link two rows up, and that link is
         * gated `canUseManagerConsole` — a manager or a super-admin. A supervisor, an
         * assistant supervisor, head office, the director, finance, HR and marketing all
         * land in this console and none of them could end their session from it.
         */}
        <ConsoleSignOut />
      </div>
    </aside>
  );
}
