'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BellRinging, ChatCircleText, DeviceMobile, type Icon, Info, Megaphone, Moon, Package, Sun, Wallet } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import {
  getPushState,
  type PushState,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push';
import { type Theme, useTheme } from '@/lib/theme-context';
import type { NotificationPreferences } from '@/lib/types';

// Notification category mutes are persisted server-side (customer-service
// /profile/notifications `categories` map), so they follow the account across devices.
// A localStorage mirror keeps the toggles instant on next open before the fetch lands.
const PREF_KEY = 'hydromart_driver_notif_prefs';
const NOTIF: { id: string; icon: Icon; def: boolean }[] = [
  { id: 'tasks', icon: Package, def: true },
  { id: 'customer', icon: ChatCircleText, def: true },
  { id: 'payout', icon: Wallet, def: true },
  { id: 'promo', icon: Megaphone, def: false },
  { id: 'dnd', icon: Moon, def: true },
];

const THEMES: { value: Theme; icon: Icon; labelKey: string }[] = [
  { value: 'light', icon: Sun, labelKey: 'themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'themeDark' },
  { value: 'system', icon: DeviceMobile, labelKey: 'themeSystem' },
];

function Settings() {
  const router = useRouter();
  const { t, locale, setLocale } = useT();
  const { theme, setTheme } = useTheme();
  const [pushState, setPushState] = useState<PushState>('unsubscribed');
  const [pushBusy, setPushBusy] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NOTIF.map((n) => [n.id, n.def])),
  );

  useEffect(() => {
    getPushState().then(setPushState).catch(() => {});
  }, []);

  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      setPushState(await (on ? subscribeToPush() : unsubscribeFromPush()));
    } catch {
      /* leave state as-is on failure */
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    // Local mirror first (instant), then reconcile with the server's stored categories.
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) setPrefs((p) => ({ ...p, ...(JSON.parse(raw) as Record<string, boolean>) }));
    api
      .get<NotificationPreferences>(endpoints.preferences.notifications, true)
      .then((res) => {
        if (res.categories && Object.keys(res.categories).length > 0) {
          setPrefs((p) => ({ ...p, ...res.categories }));
          localStorage.setItem(PREF_KEY, JSON.stringify({ ...res.categories }));
        }
      })
      .catch(() => {
        /* offline / not reachable — keep the local mirror */
      });
  }, []);

  const set = (id: string, on: boolean) => {
    const next = { ...prefs, [id]: on };
    setPrefs(next);
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
    // Persist just this category; the backend merges it over the stored map.
    void api.patch(endpoints.preferences.notifications, { categories: { [id]: on } }, true).catch(() => {});
  };

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 text-sm font-extrabold">{t('driver.settings.title')}</div>
      </header>

      <div className="px-1 pt-1 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">
        {t('driver.settings.notifSection')}
      </div>
      {pushSupported() && (
        <Card className="p-0">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-brand-50">
              <BellRinging size={18} weight="fill" className="text-brand-700" />
            </span>
            <div className="flex-1">
              <div className="text-sm font-bold">{t('driver.settings.pushLabel')}</div>
              <div className="text-[11px] text-[color:var(--muted)]">
                {pushState === 'denied'
                  ? t('driver.settings.pushDenied')
                  : t('driver.settings.pushHint')}
              </div>
            </div>
            <Toggle
              on={pushState === 'subscribed'}
              onChange={togglePush}
              disabled={pushBusy || pushState === 'denied'}
              label={t('driver.settings.pushLabel')}
            />
          </div>
        </Card>
      )}
      <Card className="divide-y divide-[color:var(--border)] p-0">
        {NOTIF.map((n) => {
          const NIcon = n.icon;
          const label = t(`driver.settings.notif.${n.id}Label`);
          return (
            <div key={n.id} className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex size-9 items-center justify-center rounded-[10px] bg-brand-50">
                <NIcon size={18} weight="fill" className="text-brand-700" />
              </span>
              <div className="flex-1">
                <div className="text-sm font-bold">{label}</div>
                <div className="text-[11px] text-[color:var(--muted)]">{t(`driver.settings.notif.${n.id}Sub`)}</div>
              </div>
              <Toggle on={prefs[n.id] ?? n.def} onChange={(v) => set(n.id, v)} label={label} />
            </div>
          );
        })}
      </Card>

      <div className="px-1 pt-2 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">
        {t('driver.settings.displaySection')}
      </div>
      <Card className="p-2">
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((th) => {
            const TIcon = th.icon;
            const active = theme === th.value;
            return (
              <button
                key={th.value}
                type="button"
                onClick={() => setTheme(th.value)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1.5 rounded-xl py-3 text-xs font-bold ${
                  active ? 'bg-brand-600 text-on-brand' : 'bg-[color:var(--surface-soft)] text-[color:var(--muted)]'
                }`}
              >
                <TIcon size={20} weight="fill" />
                {t(`driver.settings.${th.labelKey}`)}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="px-1 pt-2 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">
        {t('driver.settings.langSection')}
      </div>
      <Card className="divide-y divide-[color:var(--border)] p-0">
        <LangRow flag="🇮🇩" name={t('driver.settings.langIdName')} sub={t('driver.settings.langIdSub')} active={locale === 'id'} onClick={() => setLocale('id')} />
        <LangRow
          flag="🇬🇧"
          name={t('driver.settings.langEnName')}
          sub={t('driver.settings.langEnSub')}
          active={locale === 'en'}
          onClick={() => setLocale('en')}
        />
      </Card>

      <div className="mt-2 flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-3 text-[11.5px] leading-snug text-brand-800">
        <Info size={17} weight="fill" className="shrink-0 text-brand-700" />
        {t('driver.settings.info')}
      </div>
    </div>
  );
}

function LangRow({
  flag,
  name,
  sub,
  active,
  onClick,
}: {
  flag: string;
  name: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
      <span className="text-[22px]">{flag}</span>
      <div className="flex-1">
        <div className={`text-sm ${active ? 'font-extrabold' : 'font-semibold'}`}>{name}</div>
        <div className="text-[11px] text-[color:var(--muted)]">{sub}</div>
      </div>
      <span
        className={`flex size-5 items-center justify-center rounded-full border-2 ${active ? 'border-brand-600 bg-brand-600' : 'border-[color:var(--border)]'}`}
      >
        {active && <span className="text-[11px] font-bold text-white">✓</span>}
      </span>
    </button>
  );
}

export default function DriverSettingsPage() {
  return (
    <DriverShell nav={false}>
      <Settings />
    </DriverShell>
  );
}
