'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react';

import { HQ_GROUPS } from '@/components/hq/hq-rail';
import { useT } from '@/lib/locale-context';

// ⌘K / Ctrl+K command palette (design 23c), mounted once in the HQ layout so it's
// available everywhere under /hq. Opening is triggered by the keyboard OR a window
// event dispatched by the rail's hint button (paired literal — avoids a circular
// import back into hq-rail). Navigation is real; the list is derived from HQ_GROUPS
// (every ready screen) plus a few known quick-actions.
export const HQ_COMMAND_EVENT = 'hq:command-open';

interface Cmd {
  id: string;
  label: string;
  href: string;
  group: 'screens' | 'actions';
}

// Known quick-actions (design 23c list). Screens come from HQ_GROUPS below.
const ACTION_DEFS: { id: string; labelKey: string; href: string }[] = [
  { id: 'a-pricing', labelKey: 'pricingRule', href: '/hq/forms/pricing-rule' },
  { id: 'a-voucher', labelKey: 'voucher', href: '/hq/forms/voucher' },
  { id: 'a-onboard', labelKey: 'onboard', href: '/hq/depots?onboard=1' },
  { id: 'a-invite', labelKey: 'invite', href: '/hq/staff' },
  { id: 'a-broadcast', labelKey: 'broadcast', href: '/hq/broadcast' },
];

export function CommandPalette() {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open on ⌘K / Ctrl+K, or on the rail's window event. Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(HQ_COMMAND_EVENT, onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(HQ_COMMAND_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after paint
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        cancelAnimationFrame(id);
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  const commands = useMemo<Cmd[]>(() => {
    const screens: Cmd[] = HQ_GROUPS.flatMap((g) => g.items)
      .filter((i) => i.ready)
      .map((i) => ({ id: `s-${i.href}`, label: t(`hq.nav.${i.labelKey}`), href: i.href, group: 'screens' }));
    const actions: Cmd[] = ACTION_DEFS.map((a) => ({
      id: a.id,
      label: t(`hq.common.actions.${a.labelKey}`),
      href: a.href,
      group: 'actions',
    }));
    return [...actions, ...screens];
  }, [t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  function go(cmd: Cmd | undefined) {
    if (!cmd) return;
    setOpen(false);
    router.push(cmd.href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(filtered[active]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t('hq.common.palette.title')}
    >
      <button
        type="button"
        aria-label={t('common.back')}
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-[color:var(--text)]/40"
      />
      <div
        className="surface relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-app shadow-lift"
        style={{ animation: 'fadeUp 0.18s var(--ease-out) both' }}
      >
        <div className="flex items-center gap-2.5 border-b border-app px-4 py-3">
          <MagnifyingGlass size={18} className="text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder={t('hq.common.palette.placeholder')}
            className="w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--text-muted)]"
            aria-label={t('hq.common.palette.placeholder')}
          />
          <kbd className="rounded border border-app bg-[color:var(--surface-soft)] px-1.5 py-0.5 text-[10px] font-bold text-muted">
            {t('hq.common.kbd')}
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">{t('hq.common.palette.empty')}</p>
          ) : (
            (['actions', 'screens'] as const).map((group) => {
              const rows = filtered.filter((c) => c.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group}>
                  <p className="px-4 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted">
                    {t(`hq.common.palette.${group}`)}
                  </p>
                  {rows.map((c) => {
                    const idx = filtered.indexOf(c);
                    const on = idx === active;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(c)}
                        className={
                          'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ' +
                          (on ? 'bg-brand-50 font-semibold text-brand-800' : 'hover:bg-[color:var(--surface-soft)]')
                        }
                      >
                        <span className="truncate">{c.label}</span>
                        {on && <ArrowRight size={15} weight="bold" className="shrink-0 text-brand-600" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
