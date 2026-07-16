'use client';

import { useState } from 'react';
import { IdentificationBadge } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Card, Toggle } from '@/components/ui';
import { StubBadge, NOTIF_EVENTS_STUB, type NotifEventRow } from '@/lib/hq/stubs';
import { useToast } from '@/components/toast';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { useTheme } from '@/lib/theme-context';

// Design 23a — admin profile & notification prefs. The account block is REAL (the signed-in
// customer IS auth.me). Language + theme controls are real. The per-EVENT channel matrix has
// no endpoint (endpoints.preferences.notifications is global push/email/whatsapp), so it is
// stubbed local state — real backend track.
type Channel = 'push' | 'email' | 'wa';

export default function HqProfilePage() {
  const { t, locale, setLocale } = useT();
  const { resolved, toggle: toggleTheme } = useTheme();
  const { customer } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<NotifEventRow[]>(NOTIF_EVENTS_STUB);

  function setChan(id: string, chan: Channel, v: boolean) {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, [chan]: v } : e)));
    toast(t('hq.profile.saved'), 'success');
  }

  const account = customer && [
    { label: t('hq.profile.name'), value: customer.fullName ?? '—' },
    { label: t('hq.profile.phone'), value: customer.phone },
    { label: t('hq.profile.email'), value: customer.email ?? '—' },
    { label: t('hq.profile.role'), value: customer.role ? t(`hq.roles.${customer.role}`) : '—' },
  ];

  const channels: Channel[] = ['push', 'email', 'wa'];

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={IdentificationBadge} title={t('hq.profile.title')} subtitle={t('hq.profile.subtitle')} />

      <Card className="p-5">
        <p className="mb-3 text-sm font-extrabold">{t('hq.profile.account')}</p>
        <div className="grid grid-cols-2 gap-x-7 gap-y-4">
          {account?.map((r) => (
            <div key={r.label} className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-wide text-muted">{r.label}</div>
              <div className="mt-1 truncate text-sm font-bold">{r.value}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-extrabold">{t('hq.profile.notifTitle')}</p>
            <p className="text-xs text-muted">{t('hq.profile.notifBody')}</p>
          </div>
          <StubBadge />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-app text-xs font-medium uppercase tracking-wide text-muted">
                <th className="py-2 text-left">{t('hq.profile.event')}</th>
                {channels.map((c) => (
                  <th key={c} className="px-2 py-2 text-center">
                    {t(`hq.profile.chan.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-app last:border-0">
                  <td className="py-2.5 pr-3">{e.label}</td>
                  {channels.map((c) => (
                    <td key={c} className="px-2 py-2.5">
                      <div className="flex justify-center">
                        <Toggle on={e[c]} onChange={(v) => setChan(e.id, c, v)} label={`${e.label} · ${t(`hq.profile.chan.${c}`)}`} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <p className="text-sm font-extrabold">{t('hq.profile.language')}</p>
        <p className="text-xs text-muted">{t('hq.profile.languageBody')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-full border border-app bg-[color:var(--surface-muted)] p-[3px]">
            {(['id', 'en'] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                onClick={() => setLocale(lng)}
                aria-pressed={locale === lng}
                className={`rounded-full px-3.5 py-[5px] text-xs font-extrabold uppercase transition-colors ${
                  locale === lng ? 'bg-brand-600 text-on-brand' : 'text-muted'
                }`}
              >
                {lng}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-full border border-app px-3.5 py-[6px] text-xs font-extrabold transition-colors hover:bg-[color:var(--surface-soft)]"
          >
            {resolved === 'dark' ? t('hq.common.theme.light') : t('hq.common.theme.dark')}
          </button>
        </div>
      </Card>
    </div>
  );
}
