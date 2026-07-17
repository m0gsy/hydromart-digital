'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChatCircleText, type Icon, Info, Megaphone, Moon, Package, Wallet } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card, Toggle } from '@/components/ui';
import { useT } from '@/lib/locale-context';

// ponytail: notification prefs live in localStorage — a real device preference the
// push pipeline can read once wired. No prefs backend exists yet, so they are
// device-local (not synced per account like the design's note implies).
const PREF_KEY = 'hydromart_driver_notif_prefs';
const NOTIF: { id: string; icon: Icon; label: string; sub: string; def: boolean }[] = [
  { id: 'tasks', icon: Package, label: 'Tugas baru', sub: 'Suara + getar', def: true },
  { id: 'customer', icon: ChatCircleText, label: 'Pesan pelanggan', sub: 'Chat & panggilan', def: true },
  { id: 'payout', icon: Wallet, label: 'Payout & insentif', sub: 'Info penghasilan', def: true },
  { id: 'promo', icon: Megaphone, label: 'Promo & pengumuman', sub: 'Dari depot', def: false },
  { id: 'dnd', icon: Moon, label: 'Jangan ganggu', sub: 'Di luar shift · 22.00 – 05.00', def: true },
];

function Settings() {
  const router = useRouter();
  const { locale, setLocale } = useT();
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NOTIF.map((n) => [n.id, n.def])),
  );

  useEffect(() => {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) setPrefs((p) => ({ ...p, ...(JSON.parse(raw) as Record<string, boolean>) }));
  }, []);

  const set = (id: string, on: boolean) => {
    const next = { ...prefs, [id]: on };
    setPrefs(next);
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
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
        <div className="flex-1 text-sm font-extrabold">Pengaturan</div>
      </header>

      <div className="px-1 pt-1 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">
        Notifikasi
      </div>
      <Card className="divide-y divide-[color:var(--border)] p-0">
        {NOTIF.map((n) => {
          const NIcon = n.icon;
          return (
            <div key={n.id} className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex size-9 items-center justify-center rounded-[10px] bg-brand-50">
                <NIcon size={18} weight="fill" className="text-brand-700" />
              </span>
              <div className="flex-1">
                <div className="text-sm font-bold">{n.label}</div>
                <div className="text-[11px] text-[color:var(--muted)]">{n.sub}</div>
              </div>
              <Toggle on={prefs[n.id] ?? n.def} onChange={(v) => set(n.id, v)} label={n.label} />
            </div>
          );
        })}
      </Card>

      <div className="px-1 pt-2 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">
        Bahasa
      </div>
      <Card className="divide-y divide-[color:var(--border)] p-0">
        <LangRow flag="🇮🇩" name="Bahasa Indonesia" sub="Default" active={locale === 'id'} onClick={() => setLocale('id')} />
        <LangRow
          flag="🇬🇧"
          name="English"
          sub="Angka & Rupiah tetap format id-ID"
          active={locale === 'en'}
          onClick={() => setLocale('en')}
        />
      </Card>

      <div className="mt-2 flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-3 text-[11.5px] leading-snug text-brand-800">
        <Info size={17} weight="fill" className="shrink-0 text-brand-700" />
        Preferensi notifikasi tersimpan di perangkat ini. Bahasa berlaku untuk seluruh aplikasi.
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
