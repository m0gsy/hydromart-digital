'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, MapPin, SquaresFour } from '@phosphor-icons/react';

import { CAPABILITIES, type Capability, type Role } from '@hydromart/access';
import { hqItemsForRole } from '@/components/hq/hq-rail';
import { Card, Chip } from '@/components/ui';
import { useT } from '@/lib/locale-context';

const ROLES: Role[] = [
  'SUPER_ADMIN',
  'HEAD_OFFICE',
  'DEPOT_MANAGER',
  'DEPOT_OPERATOR',
  'DRIVER',
  'FRANCHISE_OWNER',
  'FINANCE',
  'MARKETING',
];

// Post-login landing per role (mirrors nav.tsx + dashboard/page.tsx redirect logic).
const LANDING: Record<Role, string> = {
  SUPER_ADMIN: '/hq',
  HEAD_OFFICE: '/hq',
  DEPOT_MANAGER: '/dashboard',
  DEPOT_OPERATOR: '/dashboard/orders',
  DRIVER: '/dashboard/orders',
  FRANCHISE_OWNER: '/dashboard/franchise',
  FINANCE: '/hq/payments',
  MARKETING: '/dashboard/campaigns',
  CUSTOMER: '/products',
};

function capCount(role: Role): number {
  return (Object.keys(CAPABILITIES) as Capability[]).filter((c) =>
    (CAPABILITIES[c] as readonly Role[]).includes(role),
  ).length;
}

// Design 9a — per-role landing views. Picker on the left, preview on the right.
export default function HqLandingPage() {
  const { t } = useT();
  const [role, setRole] = useState<Role>('SUPER_ADMIN');

  const menu = hqItemsForRole(role);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/hq/access"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800"
        >
          <ArrowLeft size={16} weight="bold" />
          {t('hq.landing.back')}
        </Link>
        <div className="flex items-center gap-2">
          <SquaresFour size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('hq.landing.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t('hq.landing.subtitle')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_1fr]">
        {/* Role picker */}
        <Card className="flex flex-col gap-1 p-2">
          <p className="px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-muted">
            {t('hq.landing.pickRole')}
          </p>
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={
                'flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ' +
                (role === r
                  ? 'bg-brand-50 font-bold text-brand-800'
                  : 'font-medium text-muted hover:bg-[color:var(--surface-soft)]')
              }
            >
              <span>{t(`hq.roles.${r}`)}</span>
              <span className="text-xs tabular-nums text-muted">{capCount(r)}</span>
            </button>
          ))}
        </Card>

        {/* Preview */}
        <Card className="flex flex-col gap-5 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold">{t(`hq.roles.${role}`)}</h2>
            <Chip tone="tint">{t('hq.landing.capsCount', { n: capCount(role) })}</Chip>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t('hq.landing.landsAt')}
            </p>
            <span className="inline-flex w-fit items-center gap-2 rounded-lg bg-[color:var(--surface-soft)] px-3 py-2 font-mono text-sm">
              <MapPin size={16} weight="fill" className="text-brand-600" />
              {LANDING[role]}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t('hq.landing.menuSeen')}
            </p>
            {menu.length === 0 ? (
              <p className="text-sm text-muted">{t('hq.landing.noMenu')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {menu.map((item) => (
                  <Chip key={item.href} tone="outline">
                    {t(`hq.nav.${item.labelKey}`)}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
