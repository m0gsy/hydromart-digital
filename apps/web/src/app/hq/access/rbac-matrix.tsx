'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from '@phosphor-icons/react';

import { CAPABILITIES, type Capability, type Role } from '@hydromart/access';
import { Button, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';

// Staff roles (CUSTOMER is never in the matrix). Column order is canonical + used for
// the generated diff so output is deterministic.
const ROLES: Role[] = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'HR',
  'MARKETING',
  'SUPER_ADMIN',
];

const ROLE_ABBR: Record<Role, string> = {
  CUSTOMER: 'Cus',
  STAFF_DEPOT: 'Stf',
  KEPALA_DEPOT: 'Kep',
  ASSISTANT_SUPERVISOR: 'Asv',
  SUPERVISOR: 'Spv',
  MANAGER: 'Mgr',
  DIREKTUR: 'Dir',
  FRANCHISE_OWNER: 'Fr',
  HEAD_OFFICE: 'HO',
  FINANCE: 'Fin',
  MARKETING: 'Mkt',
  HR: 'HR',
  SUPER_ADMIN: 'SA',
};

// Grouping inferred from the capability comments in packages/access/src/index.ts.
// Exported so the role-detail page groups a role's capabilities the same way.
export const CAP_SECTIONS: { key: string; caps: Capability[] }[] = [
  {
    key: 'ops',
    caps: [
      'orderQueue',
      'walkInSale',
      'inventoryRead',
      'inventoryWrite',
      'meterRead',
      'meterWrite',
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
  {
    key: 'network',
    caps: [
      'dashboard',
      'hqConsole',
      'depotAdmin',
      'depotDirectory',
      'staffAdmin',
      'staffDirectory',
      'hierarchyAdmin',
      'depotCrm',
      'depotCrmWrite',
      'auditRead',
      'pdpRequests',
      'settingsGlobal',
      'accessMatrixWrite',
    ],
  },
  // Decisions head office takes ON a depot's request. Kept as their own group because
  // every one of them is the second half of a two-party flow: the depot proposes, this
  // side disposes, and the two must never land on the same role by accident.
  {
    key: 'decisions',
    caps: [
      'priceOverrideDecide',
      'franchiseApplications',
      'voucherRequestDecide',
      'fraudReview',
    ],
  },
  {
    key: 'marketing',
    caps: [
      'campaignRead',
      'campaignWrite',
      'voucherRead',
      'voucherWrite',
      'churn',
      'rewardHandover',
      'resellerView',
      'resellerAdmin',
    ],
  },
  {
    key: 'finance',
    caps: [
      'franchise',
      'payout',
      'depotFinance',
      'depotDisputes',
      'refundIssue',
      'refundQueue',
      'settlementRead',
      'hqPayout',
      'hqPayoutRead',
      'commissionRuns',
      'earningRules',
    ],
  },
  { key: 'hr', caps: ['hrView', 'hrAdmin', 'hrPayroll', 'leaveApprove'] },
];

/**
 * Nothing may fall out of the matrix. A capability the guards enforce but this screen
 * never lists is one a super admin cannot see, let alone retune — which is how all 16 of
 * F2's new capabilities sat invisible while the editor above them looked complete.
 *
 * Anything not placed in a section by hand lands in `other` rather than disappearing.
 */
const PLACED = new Set(CAP_SECTIONS.flatMap((s) => s.caps));
const UNPLACED = (Object.keys(CAPABILITIES) as Capability[]).filter((c) => !PLACED.has(c));
if (UNPLACED.length > 0) CAP_SECTIONS.push({ key: 'other', caps: UNPLACED });

type Grid = Record<Capability, Role[]>;

// GET /access/matrix — effective is defaults + super-admin overrides, i.e. what the
// Nest guards enforce right now.
interface AccessMatrixResponse {
  effective?: Partial<Record<Capability, Role[]>>;
}

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
  // `baseline` is what the SERVER currently enforces (compiled defaults with the
  // super-admin overrides applied), not what this build was compiled with — otherwise
  // an earlier edit would show up as an unsaved change on every visit.
  const [baseline, setBaseline] = useState<Grid>(cloneCaps);
  const [grid, setGrid] = useState<Grid>(cloneCaps);
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<AccessMatrixResponse>(endpoints.auth.matrix, true)
      .then((res) => {
        if (!alive) return;
        const next = cloneCaps();
        (Object.keys(next) as Capability[]).forEach((c) => {
          const roles = res.effective?.[c];
          if (roles) next[c] = [...roles] as Role[];
        });
        setBaseline(next);
        setGrid(next);
      })
      .catch(() => {
        /* fall back to the compiled defaults already in state */
      });
    return () => {
      alive = false;
    };
  }, []);

  const changed = useMemo(
    () => (Object.keys(CAPABILITIES) as Capability[]).filter((c) => !sameRoles(grid[c], baseline[c])),
    [grid, baseline],
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

  // Column bulk-toggle: if the role already holds every capability, clear it from all;
  // otherwise grant it to all. (spec 2a roleHeads.toggle)
  function toggleRole(role: Role) {
    setCopied(false);
    setGrid((prev) => {
      const caps = Object.keys(prev) as Capability[];
      const hasAll = caps.every((c) => prev[c].includes(role));
      const out = {} as Grid;
      caps.forEach((c) => {
        out[c] = hasAll
          ? prev[c].filter((r) => r !== role)
          : prev[c].includes(role)
            ? prev[c]
            : [...prev[c], role];
      });
      return out;
    });
  }

  // Row bulk-toggle: grant the cap to every role, or clear it entirely if already full.
  // (spec 2a cap.toggleRow)
  function toggleCap(cap: Capability) {
    setCopied(false);
    setGrid((prev) => {
      const hasAll = ROLES.every((r) => prev[cap].includes(r));
      return { ...prev, [cap]: hasAll ? [] : [...ROLES] };
    });
  }

  function reset() {
    setGrid(baseline);
    setShowDiff(false);
    setCopied(false);
    setError(null);
  }

  /**
   * Write each changed capability. A capability dragged back to its compiled default is
   * DELETEd rather than stored as an identical override, so the table only ever holds
   * real deviations and "reset to default" stays a meaningful state.
   */
  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const cap of changed) {
        const roles = ROLES.filter((r) => grid[cap].includes(r));
        if (sameRoles(roles, CAPABILITIES[cap])) {
          await api.del(endpoints.auth.capability(cap), true);
        } else {
          await api.put(endpoints.auth.capability(cap), { roles }, true);
        }
      }
      setBaseline(grid);
      setShowDiff(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
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
            <Button variant="ghost" onClick={reset} disabled={saving}>
              {t('hq.access.reset')}
            </Button>
            <Button variant="secondary" onClick={() => setShowDiff((v) => !v)}>
              {t('hq.access.diff')}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? t('hq.access.saving') : t('hq.access.save')}
            </Button>
          </div>
          {error && <p className="w-full text-xs text-danger">{error}</p>}
          <p className="w-full text-xs text-brand-700">{t('hq.access.propagation')}</p>
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
                <th key={r} className="px-1.5 py-2.5 text-center text-[11px] font-bold text-muted">
                  <button
                    type="button"
                    onClick={() => toggleRole(r)}
                    title={`${t(`hq.roles.${r}`)} — ${t('hqFix.toggleCol')}`}
                    className="w-full rounded px-1 py-0.5 transition-colors hover:bg-brand-50 hover:text-brand-700"
                  >
                    {ROLE_ABBR[r]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAP_SECTIONS.map((section) => (
              <SectionRows
                key={section.key}
                section={section}
                grid={grid}
                onToggle={toggle}
                onToggleCap={toggleCap}
              />
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
  onToggleCap,
}: {
  section: { key: string; caps: Capability[] };
  grid: Grid;
  onToggle: (cap: Capability, role: Role) => void;
  onToggleCap: (cap: Capability) => void;
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
            <button
              type="button"
              onClick={() => onToggleCap(cap)}
              title={t('hqFix.toggleRow')}
              className="text-left transition-opacity hover:opacity-70"
            >
              {t(`hq.access.caps.${cap}`)}
            </button>
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
