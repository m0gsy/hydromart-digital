'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, ShieldCheck } from '@phosphor-icons/react';

import { BuiltInRolesPanel } from './built-in-roles-panel';
import { CustomRolesPanel, DepotRulesPanel } from './custom-roles-panels';
import { RbacMatrix } from './rbac-matrix';
import { useT } from '@/lib/locale-context';

// Design 2a (HERO) — editable capability × role matrix. It reads the server's EFFECTIVE map
// (compiled defaults + the super-admin overrides) and saves changes as one transaction.
// Below it: the custom roles themselves, and per-depot exceptions to the matrix.
export default function HqAccessPage() {
  const { t } = useT();
  // Bumped when a role is created/renamed/archived so the matrix refetches its columns.
  const [rev, setRev] = useState(0);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={24} weight="fill" className="text-brand-500" />
            <h1 className="text-2xl font-bold">{t('hq.access.title')}</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('hq.access.subtitle')}</p>
        </div>
        <Link
          href="/hq/access/landing"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800"
        >
          {t('hq.access.landingLink')}
          <ArrowRight size={16} weight="bold" />
        </Link>
      </div>

      <BuiltInRolesPanel refreshKey={rev} onChanged={() => setRev((n) => n + 1)} />
      <CustomRolesPanel onChanged={() => setRev((n) => n + 1)} />
      <RbacMatrix key={rev} />
      <DepotRulesPanel refreshKey={rev} />
    </div>
  );
}
