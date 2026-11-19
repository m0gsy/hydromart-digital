'use client';

import { UserGear } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { StaffInvite } from '@/components/hq/staff-invite';
import { StaffDirectory } from '@/components/staff/staff-directory';
import { LinkButton } from '@/components/ui';
import { useT } from '@/lib/locale-context';

// Design 4a/4b — network staff directory with a role filter and the invite form.
export default function HqStaffPage() {
  const { t } = useT();

  return (
    <StaffDirectory
      header={({ reload: reloadAll, canAdmin: canAdminStaff }) => (
        <HqPageHeader
          icon={UserGear}
          title={t('hq.staff.title')}
          subtitle={t('hq.staff.subtitle')}
          /*
           * Every write on this page needs `staffAdmin` (invite, import, depot move, enable
           * / disable — account.controller gates all four), and this console admits DIREKTUR
           * as well, who does not hold it. Only the delete button was ever guarded, so a
           * DIREKTUR could open the depot picker, confirm the dialog, and collect a 403 the
           * screen never warned them about. Guarded once, here and at each control, rather
           * than per-symptom.
           */
          action={
            canAdminStaff ? (
              <div className="flex flex-wrap gap-2">
                {/* The import wizard was reachable only from the HQ rail's forms group. */}
                <LinkButton href="/hq/staff/import" variant="secondary">
                  {t('hq.nav.staffImport')}
                </LinkButton>
                <StaffInvite onSaved={reloadAll} />
              </div>
            ) : null
          }
        />
      )}
    />
  );
}
