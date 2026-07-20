'use client';

import { Lock, ShieldCheck } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { isStaff } from '@/lib/roles';
import { CAPABILITIES } from '@hydromart/access';

// Display roles (CUSTOMER holds no depot capability, so it is omitted). Order groups
// depot staff first, then oversight/office roles. DEPOT_MANAGER is the highlighted row.
// Labels are resolved via t('dashC.roles.role.<KEY>').
const ROLE_KEYS: string[] = [
  'DEPOT_OPERATOR',
  'DEPOT_MANAGER',
  'DRIVER',
  'HEAD_OFFICE',
  'FRANCHISE_OWNER',
  'MARKETING',
  'FINANCE',
  'SUPER_ADMIN',
];

function MatrixBody() {
  const { t } = useT();
  const caps = Object.keys(CAPABILITIES);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('dashC.roles.heading')}</h1>
          <p className="text-sm text-[color:var(--text-muted)]">{t('dashC.roles.subtitle')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {caps.map((cap) => {
          const holders = CAPABILITIES[cap as keyof typeof CAPABILITIES] as readonly string[];
          return (
            <Card key={cap} className="flex flex-col gap-2 p-4">
              <p className="text-sm font-semibold">{t(`dashC.roles.cap.${cap}`)}</p>
              <div className="flex flex-wrap gap-1.5">
                {ROLE_KEYS.filter((key) => holders.includes(key)).map((key) =>
                  key === 'DEPOT_MANAGER' ? (
                    <Chip key={key} tone="tint" className="bg-brand-600 text-on-brand">
                      {t(`dashC.roles.role.${key}`)}
                    </Chip>
                  ) : (
                    <Chip key={key} tone="outline">
                      {t(`dashC.roles.role.${key}`)}
                    </Chip>
                  ),
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="flex flex-col gap-1 bg-brand-50 p-4">
        <p className="text-sm font-semibold text-brand-800">{t('dashC.roles.readOnly')}</p>
        <p className="text-[12.5px] text-brand-800">
          {t('dashC.roles.readOnlyBody')}
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!isStaff(customer?.role)) {
    return (
      <CenterState title={t('dashC.roles.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashC.roles.gateBody')}
      </CenterState>
    );
  }
  return <MatrixBody />;
}

export default function RolesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
