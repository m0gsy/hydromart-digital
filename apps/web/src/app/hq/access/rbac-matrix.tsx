'use client';

import { useMemo, useState } from 'react';
import { Check } from '@phosphor-icons/react';

import { CAPABILITIES, type Capability, type Role } from '@hydromart/access';
import { Button, Card } from '@/components/ui';
import { useT } from '@/lib/locale-context';

// Staff roles (CUSTOMER is never in the matrix). Column order is canonical + used for
// the generated diff so output is deterministic.
const ROLES: Role[] = [
  'DRIVER',
  'DEPOT_OPERATOR',
  'DEPOT_MANAGER',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'MARKETING',
  'SUPER_ADMIN',
];

const ROLE_ABBR: Record<Role, string> = {
  CUSTOMER: 'Cus',
  DRIVER: 'Drv',
  DEPOT_OPERATOR: 'Ops',
  DEPOT_MANAGER: 'Mgr',
  FRANCHISE_OWNER: 'Fr',
  HEAD_OFFICE: 'HO',
  FINANCE: 'Fin',
  MARKETING: 'Mkt',
  SUPER_ADMIN: 'SA',
};

// Grouping inferred from the capability comments in packages/access/src/index.ts.
// Exported so the role-detail page groups a role's capabilities the same way.
export const CAP_SECTIONS: { key: string; caps: Capability[] }[] = [
  {
    key: 'ops',
    caps: [
      'orderQueue',
      'inventoryRead',
      'inventoryWrite',
      'returnsRead',
      'returnsWrite',
      'tracking',
      'forecast',
      'opsNotif',
      'driverRoster',
      'paymentSettle',
      'incidents',
      'approvals',
      'procurement',
    ],
  },
  {
    key: 'courier',
    caps: ['courierPayout', 'courierSettle', 'courierReturn', 'expenseApprove', 'depotBroadcast'],
  },
  {
    key: 'depotTeam',
    caps: [
      'depotHuddle',
      'depotHandover',
      'depotMaintenance',
      'depotTargets',
      'depotWholesale',
      'depotSubscriptions',
    ],
  },
  { key: 'network', caps: ['dashboard', 'depotAdmin', 'staffAdmin', 'depotCrm', 'auditRead'] },
  { key: 'marketing', caps: ['campaignRead', 'campaignWrite', 'voucherRead', 'voucherWrite', 'churn'] },
  { key: 'finance', caps: ['franchise', 'payout', 'depotFinance', 'depotDisputes'] },
];

type Grid = Record<Capability, Role[]>;

function cloneCaps(): Grid {
  const out = {} as Grid;
  (Object.keys(CAPABILITIES) as Capability[]).forEach((c) => {
    out[c] = [...CAPABILITIES[c]];
  });
  return out;
}

function sameRoles(a: Role[], b: readonly Role[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((r) => sb.has(r));
}

export function RbacMatrix() {
  const { t } = useT();
  const [grid, setGrid] = useState<Grid>(cloneCaps);
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);

  const changed = useMemo(
    () => (Object.keys(CAPABILITIES) as Capability[]).filter((c) => !sameRoles(grid[c], CAPABILITIES[c])),
    [grid],
  );

  const dirty = changed.length > 0;

  function toggle(cap: Capability, role: Role) {
    setCopied(false);
    setGrid((prev) => {
      const has = prev[cap].includes(role);
      const next = has ? prev[cap].filter((r) => r !== role) : [...prev[cap], role];
      return { ...prev, [cap]: next };
    });
  }

  function reset() {
    setGrid(cloneCaps());
    setShowDiff(false);
    setCopied(false);
  }

  const diffText = changed
    .map((c) => {
      const roles = ROLES.filter((r) => grid[c].includes(r));
      return `  ${c}: [${roles.map((r) => `'${r}'`).join(', ')}],`;
    })
    .join('\n');

  async function copyDiff() {
    try {
      await navigator.clipboard.writeText(diffText);
      setCopied(true);
    } catch {
      /* clipboard blocked — the code block is still selectable */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {dirty && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand-400 bg-brand-50 p-4">
          <div className="min-w-0">
            <p className="font-semibold text-brand-800">{t('hq.access.dirtyTitle', { n: changed.length })}</p>
            <p className="text-xs text-brand-700">{t('hq.access.dirtyBody')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset}>
              {t('hq.access.reset')}
            </Button>
            <Button variant="secondary" onClick={() => setShowDiff((v) => !v)}>
              {t('hq.access.diff')}
            </Button>
          </div>
        </Card>
      )}

      {dirty && showDiff && (
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{t('hq.access.diffTitle')}</p>
            <Button variant="ghost" onClick={copyDiff}>
              {copied ? t('hq.access.copied') : t('hq.access.copy')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('hq.access.diffHint')}</p>
          <pre className="overflow-x-auto rounded-lg bg-[color:var(--surface-soft)] p-3 text-xs">
            <code>{diffText}</code>
          </pre>
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[color:var(--surface)] px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted">
                {t('hq.access.title')}
              </th>
              {ROLES.map((r) => (
                <th
                  key={r}
                  title={t(`hq.roles.${r}`)}
                  className="px-1.5 py-2.5 text-center text-[11px] font-bold text-muted"
                >
                  {ROLE_ABBR[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAP_SECTIONS.map((section) => (
              <SectionRows key={section.key} section={section} grid={grid} onToggle={toggle} />
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-muted">{t('hq.access.footer')}</p>
    </div>
  );
}

function SectionRows({
  section,
  grid,
  onToggle,
}: {
  section: { key: string; caps: Capability[] };
  grid: Grid;
  onToggle: (cap: Capability, role: Role) => void;
}) {
  const { t } = useT();
  return (
    <>
      <tr>
        <td
          colSpan={ROLES.length + 1}
          className="sticky left-0 bg-[color:var(--surface-soft)] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted"
        >
          {t(`hq.access.groups.${section.key}`)}
        </td>
      </tr>
      {section.caps.map((cap) => (
        <tr key={cap} className="border-t border-app">
          <td className="sticky left-0 z-10 bg-[color:var(--surface)] px-3 py-2 font-medium">
            {t(`hq.access.caps.${cap}`)}
          </td>
          {ROLES.map((role) => {
            const on = grid[cap].includes(role);
            return (
              <td key={role} className="px-1.5 py-1 text-center">
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${t(`hq.access.caps.${cap}`)} · ${t(`hq.roles.${role}`)}`}
                  onClick={() => onToggle(cap, role)}
                  className={
                    'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ' +
                    (on
                      ? 'bg-brand-600 text-on-brand hover:bg-brand-700'
                      : 'border border-app text-transparent hover:bg-brand-50')
                  }
                >
                  <Check size={15} weight="bold" />
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
