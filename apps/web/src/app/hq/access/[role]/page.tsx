'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, IdentificationBadge } from '@phosphor-icons/react';

import { CAPABILITIES, type Capability, type Role } from '@hydromart/access';
import { CAP_SECTIONS } from '../rbac-matrix';
import { Card, Chip } from '@/components/ui';
import { useT } from '@/lib/locale-context';

const ALL_ROLES: Role[] = [
  'CUSTOMER',
  'DRIVER',
  'DEPOT_OPERATOR',
  'DEPOT_MANAGER',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'MARKETING',
  'SUPER_ADMIN',
];

const TOTAL_CAPS = Object.keys(CAPABILITIES).length;

// Design 19a — role detail: every capability one role holds, grouped by area.
export default function HqRoleDetailPage() {
  const { t } = useT();
  const param = useParams();
  const raw = Array.isArray(param.role) ? param.role[0] : param.role;
  const role = ALL_ROLES.find((r) => r === raw);

  const back = (
    <Link
      href="/hq/access"
      className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800"
    >
      <ArrowLeft size={16} weight="bold" />
      {t('hq.roleDetail.back')}
    </Link>
  );

  if (!role) {
    return (
      <div>
        {back}
        <p className="text-sm text-muted">{t('hq.roleDetail.notFound')}</p>
      </div>
    );
  }

  const held = (c: Capability) => (CAPABILITIES[c] as readonly Role[]).includes(role);
  const heldCount = (Object.keys(CAPABILITIES) as Capability[]).filter(held).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        {back}
        <div className="flex items-center gap-2">
          <IdentificationBadge size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t(`hq.roles.${role}`)}</h1>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          {t('hq.roleDetail.subtitle')}
          <Chip tone="tint">{t('hq.roleDetail.capsCount', { n: heldCount, total: TOTAL_CAPS })}</Chip>
        </p>
      </div>

      {heldCount === 0 ? (
        <p className="text-sm text-muted">{t('hq.roleDetail.empty')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {CAP_SECTIONS.map((section) => {
            const caps = section.caps.filter(held);
            if (caps.length === 0) return null;
            return (
              <Card key={section.key} className="flex flex-col gap-3 p-5">
                <h2 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
                  {t(`hq.access.groups.${section.key}`)}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {caps.map((c) => (
                    <Chip key={c} tone="tint">
                      {t(`hq.access.caps.${c}`)}
                    </Chip>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
