'use client';

import Link from 'next/link';
import { CheckCircle, HandWaving, ChartLineUp, Lock, Tag, type Icon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

const DUTIES: { icon: Icon; title: string; desc: string }[] = [
  {
    icon: CheckCircle,
    title: 'Setujui aksi operator',
    desc: 'Tinjau opname, refund deposit & selisih COD yang melewati ambang depot.',
  },
  {
    icon: Tag,
    title: 'Atur harga & voucher',
    desc: 'Kelola harga dinamis depot dan voucher lokal untuk pelangganmu.',
  },
  {
    icon: ChartLineUp,
    title: 'Pantau performa tim',
    desc: 'Lihat kartu performa mingguan kurir & operator dari dashboard.',
  },
];

function OnboardingBody() {
  const { customer } = useAuth();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <Card elevated className="flex flex-col items-center gap-3 bg-brand-700 p-8 text-center text-on-brand">
        <span className="flex size-16 items-center justify-center rounded-full bg-white/15">
          <HandWaving size={34} weight="fill" />
        </span>
        <h1 className="text-2xl font-bold">Selamat datang, {customer?.fullName ?? 'Manajer'}</h1>
        <p className="text-sm text-white/85">
          Ini panduan singkat peranmu sebagai Manajer depot. Yuk kenali tugas utamamu.
        </p>
      </Card>

      <div className="flex flex-col gap-3">
        {DUTIES.map((d) => {
          const DIcon = d.icon;
          return (
            <Card key={d.title} className="flex items-start gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <DIcon size={22} weight="fill" />
              </span>
              <div>
                <p className="font-semibold">{d.title}</p>
                <p className="text-[12.5px] text-[color:var(--text-muted)]">{d.desc}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2" aria-hidden="true">
        <span className="size-2 rounded-full bg-brand-600" />
        <span className="size-2 rounded-full bg-brand-200" />
        <span className="size-2 rounded-full bg-brand-200" />
      </div>

      <div className="flex gap-3">
        <Link
          href="/dashboard"
          className="flex-1 rounded-lg border border-app px-4 py-2.5 text-center text-sm font-semibold text-[color:var(--text-muted)]"
        >
          Lewati
        </Link>
        <Link
          href="/dashboard"
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-on-brand hover:bg-brand-700"
        >
          Mulai tur
        </Link>
      </div>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Tur onboarding ini hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <OnboardingBody />;
}

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
