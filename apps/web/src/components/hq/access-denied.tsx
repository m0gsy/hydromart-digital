'use client';

import { Lock } from '@phosphor-icons/react';

import { CenterState, Chip, LinkButton } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import { consoleHome } from '@/lib/roles';

// Design 20c — "Khusus HQ" access-denied. Rendered by the HQ layout gate and reused
// by any page-level gate. The HQ reach itself (isHq) is a coarse gate over
// HEAD_OFFICE / SUPER_ADMIN; the chip names the capabilities those roles carry.
// The console shell has no top nav, so the way back out has to live on this screen —
// and it points at the console this role actually owns, never a second denial.
export function AccessDeniedHq({ role }: { role?: string | null }) {
  const { t } = useT();
  const roleLabel = role ? t(`hq.roles.${role}`) : t('hq.common.dash');
  return (
    <CenterState
      icon={<Lock size={40} weight="fill" />}
      title={t('hq.denied.title')}
      action={
        <div className="flex flex-col items-center gap-3">
          <Chip tone="amber">{t('hq.denied.cap')}</Chip>
          <LinkButton href={consoleHome(role)} variant="secondary">
            {t('hq.denied.back')}
          </LinkButton>
        </div>
      }
    >
      {t('hq.denied.body', { role: roleLabel })}
    </CenterState>
  );
}
