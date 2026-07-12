'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CaretRight,
  Gift,
  MapPin,
  Receipt,
  SignOut,
  Translate,
  ChartLineUp,
} from '@phosphor-icons/react';

import { Card, CenterState, LinkButton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canViewDashboard, isStaff } from '@/lib/roles';

export default function AccountPage() {
  const { customer, ready, signOut } = useAuth();
  const { t, locale, toggle } = useT();
  const router = useRouter();

  if (ready && !customer) {
    return (
      <CenterState
        icon={<Receipt size={40} weight="duotone" />}
        title={t('account.guestTitle')}
        action={<LinkButton href="/login">{t('nav.signIn')}</LinkButton>}
      >
        {t('account.guestBody')}
      </CenterState>
    );
  }

  const initial = customer?.fullName?.trim()?.[0]?.toUpperCase() ?? '?';
  const opsHref = customer && canViewDashboard(customer.role) ? '/dashboard' : '/dashboard/orders';
  const showOps = customer && isStaff(customer.role);

  const rows = [
    { href: '/orders', label: t('account.orders'), icon: Receipt },
    { href: '/addresses', label: t('account.addresses'), icon: MapPin },
    { href: '/rewards', label: t('account.rewards'), icon: Gift },
    ...(showOps ? [{ href: opsHref, label: t('account.ops'), icon: ChartLineUp }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('account.title')}</h1>

      {/* profile */}
      <Card className="flex items-center gap-4 p-5">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-xl font-extrabold text-brand-800">
          {initial}
        </span>
        <div className="min-w-0">
          <div className="truncate text-lg font-extrabold">{customer?.fullName ?? '—'}</div>
          <div className="truncate text-sm text-muted">
            {customer?.phone ?? customer?.email ?? ''}
          </div>
        </div>
      </Card>

      {/* links */}
      <Card className="divide-y divide-[color:var(--border)] overflow-hidden">
        {rows.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-brand-50"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <Icon size={20} weight="fill" />
            </span>
            <span className="flex-1 font-bold">{label}</span>
            <CaretRight size={18} className="text-muted" />
          </Link>
        ))}
      </Card>

      {/* language + logout */}
      <Card className="divide-y divide-[color:var(--border)] overflow-hidden">
        <button
          onClick={toggle}
          className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-brand-50"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Translate size={20} weight="fill" />
          </span>
          <span className="flex-1 font-bold">{t('account.language')}</span>
          <span className="text-sm font-bold text-muted uppercase">{locale}</span>
        </button>
        <button
          onClick={() => {
            signOut();
            router.push('/');
          }}
          className="flex w-full items-center gap-3 px-5 py-4 text-left text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger-bg)]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--danger-bg)]">
            <SignOut size={20} weight="fill" />
          </span>
          <span className="flex-1 font-bold">{t('account.logout')}</span>
        </button>
      </Card>
    </div>
  );
}
