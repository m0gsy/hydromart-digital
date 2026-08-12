'use client';

import { useMemo, useState } from 'react';
import { Storefront, TreeStructure, UserGear, X } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { AccessDeniedHq } from '@/components/hq/access-denied';
import { Badge, Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import type { Customer, Depot, Page } from '@/lib/types';

/**
 * Roles whose supervision link ALSO widens what they can see: the assistant → supervisor →
 * manager chain is what `derive()` walks to resolve depots.
 *
 * Everyone else may still be recorded here — a courier reports to a kepala depot, a kepala
 * depot to an assistant — the link is simply a reporting line and grants nothing. Saying
 * which is which on screen is the point: the page used to accept only these three, which
 * left "who reports to whom" looking unanswerable for everybody else.
 */
const DEPOT_GRANTING_ROLES = ['ASSISTANT_SUPERVISOR', 'SUPERVISOR', 'MANAGER'] as const;

/** How many staff the name search returns; the directory is far past 200 rows now. */
const SEARCH_LIMIT = 25;

// The admin listing returns the full record, so the assistant comes back with it.
type SupervisedDepot = Depot & { assistantSupervisorId?: string | null };

interface Described {
  superiorId: string | null;
  subordinateIds: string[];
  assistantDepotIds: string[];
  directDepotIds: string[];
}

/**
 * The two whole-network reads this page needs, each paged to exhaustion at the cap.
 *
 * Both asked for `limit: 200`, and BOTH services cap that field at 100 — so the depot card
 * rendered "limit must not be greater than 100" instead of the hierarchy, and the assistant
 * picker behind it was equally dead. Paged at the cap rather than lowered to it: depot 101
 * would otherwise vanish from the map silently, which is the same failure wearing a nicer
 * face. Same shape as `readLinkedAccountIds` on the staff console (K-5).
 */
const PAGE = 100;

async function readAllPages<T>(url: (page: number) => string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page += 1) {
    const { items, total } = await api.get<Page<T>>(url(page), true);
    rows.push(...items);
    if (items.length < PAGE || rows.length >= total) return rows;
  }
}

const readAllAssistants = () =>
  readAllPages<Customer>((page) =>
    endpoints.auth.staff({ page, limit: PAGE, role: 'ASSISTANT_SUPERVISOR' }),
  );

const readAllDepots = () =>
  readAllPages<SupervisedDepot>((page) => endpoints.depots.manage({ page, limit: PAGE }));

/**
 * The supervision map (F3/F4): who supervises whom, and which depots that reaches.
 *
 * This screen is the only way to populate multi-depot scope — with it empty, every
 * supervisor sees nothing but their own token depot. Writing it is `hierarchyAdmin`
 * (SUPER_ADMIN by default) because it decides who can see which depot's money.
 */
export default function HqHierarchyPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const [staffId, setStaffId] = useState('');
  const [busy, setBusy] = useState(false);

  // Name/phone search rather than one big page: after HR and the staff console started
  // creating each other's records, the directory outgrew any cap this page could set.
  const [query, setQuery] = useState('');
  // K-8: debounced, not per keystroke. `onChange` fed `useAsync` directly, so every letter
  // typed was one authenticated staff search — the browser baseline (F-12) records this
  // read as costing one request per *debounced* keystroke, so that was a baseline violation
  // and not only a nicety.
  const search = useDebounce(query).trim();
  const staff = useAsync<Page<Customer>>(
    () => api.get(endpoints.auth.staff({ limit: SEARCH_LIMIT, search: search || undefined }), true),
    [search],
  );
  const depots = useAsync<SupervisedDepot[]>(() => readAllDepots(), []);
  const detail = useAsync<Described | null>(
    () => (staffId ? api.get<Described>(endpoints.hierarchy.describe(staffId), true) : Promise.resolve(null)),
    [staffId],
  );
  const assistantPage = useAsync<Customer[]>(() => readAllAssistants(), []);

  const d = detail.data;
  /*
   * C-4: the SELECTED person's record, resolved by id rather than looked up in whatever the
   * search box last returned. `staffId` survives a query change and `people` does not, so
   * `people.find(...)` came back undefined, `grantsDepots('')` was false, and the label
   * claimed "reporting line only" for an ASSISTANT_SUPERVISOR whose link genuinely widens
   * RBAC scope. Defaulting to the reassuring answer is the one thing that label must not do.
   *
   * Same read resolves the recorded superior for C-3, so both survive a query change.
   */
  const linkedIds = [staffId, d?.superiorId ?? ''].filter(Boolean) as string[];
  const linked = useAsync<Customer[]>(
    () =>
      linkedIds.length > 0
        ? api.get<Customer[]>(endpoints.auth.customersByIds(linkedIds), true).catch(() => [])
        : Promise.resolve([]),
    [linkedIds.join(',')],
  );
  const selected = linked.data?.find((p) => p.id === staffId) ?? null;
  const superior = linked.data?.find((p) => p.id === d?.superiorId) ?? null;

  const people = useMemo(() => staff.data?.items ?? [], [staff.data]);
  const depotRows = useMemo(() => depots.data ?? [], [depots.data]);
  const nameOf = useMemo(() => {
    const map = new Map(
      [...people, ...(linked.data ?? [])].map((p) => [p.id, p.fullName || p.phone]),
    );
    return (id: string) => map.get(id) ?? id;
  }, [people, linked.data]);
  const depotName = useMemo(() => {
    const map = new Map(depotRows.map((d) => [d.id, `${d.code} · ${d.name}`]));
    return (id: string) => map.get(id) ?? id;
  }, [depotRows]);

  // Candidate superiors: ANY other staff member. A courier reports to a kepala depot and a
  // kepala depot to an assistant — refusing to record those was what made the chain look
  // broken. The server rejects a cycle; this only keeps the obvious mistake off the list.
  //
  // C-3: the recorded superior is always in the option set, even when they are outside the
  // current 25 results. A `<select value={id}>` with no matching `<option>` falls back to
  // the first one, so the screen read "Tanpa atasan" for somebody who has one.
  const superiors = useMemo(() => {
    const list = people.filter((p) => p.id !== staffId);
    const current = d?.superiorId;
    if (current && !list.some((p) => p.id === current) && superior) list.unshift(superior);
    return list;
  }, [people, staffId, d?.superiorId, superior]);
  const grantsDepots = (role: string) => (DEPOT_GRANTING_ROLES as readonly string[]).includes(role);
  /*
   * C-3: the depot → assistant picker reads for itself. Filtering the 25-row NAME SEARCH
   * for `ASSISTANT_SUPERVISOR` left the bottom rung of the whole chain empty unless the
   * operator happened to have searched an assistant by name — a hard regression against the
   * `limit: 200` this page replaced, on the one control that must always be usable.
   */
  const assistants = assistantPage.data ?? [];

  if (!can('hierarchyAdmin', customer?.role)) return <AccessDeniedHq role={customer?.role} />;

  async function run(action: () => Promise<unknown>, reload: () => void) {
    setBusy(true);
    try {
      await action();
      toast(t('hq.hierarchy.saved'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.hierarchy.error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={TreeStructure} title={t('hq.hierarchy.title')} subtitle={t('hq.hierarchy.subtitle')} />

      {/* ---- Depot -> assistant supervisor. The bottom rung: without it the whole chain
              resolves to nothing, however many superior links are recorded above. ---- */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Storefront size={18} weight="fill" className="text-brand-500" />
          <h2 className="font-bold">{t('hq.hierarchy.depotsHead')}</h2>
        </div>
        <p className="text-xs text-muted">{t('hq.hierarchy.depotsHint')}</p>
        {depots.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : depots.error ? (
          <ErrorState message={depots.error} onRetry={depots.reload} />
        ) : (
          <div className="flex flex-col gap-2">
            {depotRows.map((depot) => (
              <DepotRow
                key={depot.id}
                depot={depot}
                assistants={assistants}
                busy={busy}
                onChange={(assistantId) =>
                  run(
                    () =>
                      assistantId
                        ? api.put(
                            endpoints.hierarchy.depotAssistant(depot.id),
                            { assistantSupervisorId: assistantId },
                            true,
                          )
                        : api.del(endpoints.hierarchy.depotAssistant(depot.id), true),
                    () => {
                      depots.reload();
                      detail.reload();
                    },
                  )
                }
              />
            ))}
          </div>
        )}
      </Card>

      {/* ---- One account's place in the chain ---- */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <UserGear size={18} weight="fill" className="text-brand-500" />
          <h2 className="font-bold">{t('hq.hierarchy.staffHead')}</h2>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">{t('hq.hierarchy.search')}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('hq.hierarchy.searchHint')}
            className="rounded-lg border border-app bg-[color:var(--surface)] px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">{t('hq.hierarchy.pickStaff')}</span>
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="rounded-lg border border-app bg-[color:var(--surface)] px-3 py-2"
          >
            <option value="">{t('hq.hierarchy.pickStaffNone')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.fullName || p.phone)} — {t(`hq.roles.${p.role}`)}
              </option>
            ))}
          </select>
          {staff.data && staff.data.total > people.length && (
            <span className="text-xs text-muted">
              {t('hq.hierarchy.moreResults', { n: staff.data.total - people.length })}
            </span>
          )}
        </label>

        {!staffId ? (
          <CenterState title={t('hq.hierarchy.pickFirst')} icon={<TreeStructure size={40} weight="fill" />} />
        ) : detail.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : detail.error ? (
          <ErrorState message={detail.error} onRetry={detail.reload} />
        ) : d ? (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">{t('hq.hierarchy.superior')}</span>
              <select
                value={d.superiorId ?? ''}
                disabled={busy}
                onChange={(e) =>
                  run(
                    () =>
                      e.target.value
                        ? api.put(
                            endpoints.hierarchy.superior(staffId),
                            { superiorId: e.target.value },
                            true,
                          )
                        : api.del(endpoints.hierarchy.superior(staffId), true),
                    detail.reload,
                  )
                }
                className="rounded-lg border border-app bg-[color:var(--surface)] px-3 py-2"
              >
                <option value="">{t('hq.hierarchy.noSuperior')}</option>
                {superiors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.fullName || p.phone)} — {t(`hq.roles.${p.role}`)}
                  </option>
                ))}
              </select>
              {/* The honest answer to "does saving this change what they can see?". Only the
                  assistant → supervisor → manager chain widens depot scope; every other link
                  is a reporting line and nothing more. */}
              <span className="text-xs text-muted">
                {d.superiorId
                  ? grantsDepots(selected?.role ?? '')
                    ? t('hq.hierarchy.linkGrants')
                    : t('hq.hierarchy.linkReportsOnly')
                  : t('hq.hierarchy.linkNone')}
              </span>
            </label>

            <Facts label={t('hq.hierarchy.subordinates')} empty={t('hq.hierarchy.none')}>
              {d.subordinateIds.map((id) => (
                <Badge key={id} tone="brand">
                  {nameOf(id)}
                </Badge>
              ))}
            </Facts>

            {/* Derived, not editable here: it follows from the depot rows above. */}
            <Facts label={t('hq.hierarchy.supervised')} empty={t('hq.hierarchy.none')}>
              {d.assistantDepotIds.map((id) => (
                <Badge key={id} tone="neutral">
                  {depotName(id)}
                </Badge>
              ))}
            </Facts>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">{t('hq.hierarchy.direct')}</span>
              <p className="text-xs text-muted">{t('hq.hierarchy.directHint')}</p>
              <div className="flex flex-wrap gap-2">
                {d.directDepotIds.length === 0 && (
                  <span className="text-sm text-muted">{t('hq.hierarchy.none')}</span>
                )}
                {d.directDepotIds.map((id) => (
                  <Button
                    key={id}
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api.del(endpoints.hierarchy.depotGrant(staffId, id), true),
                        detail.reload,
                      )
                    }
                  >
                    {depotName(id)}
                    <X size={13} weight="bold" />
                  </Button>
                ))}
              </div>
              <select
                value=""
                disabled={busy}
                onChange={(e) =>
                  e.target.value &&
                  run(
                    () => api.put(endpoints.hierarchy.depotGrant(staffId, e.target.value), {}, true),
                    detail.reload,
                  )
                }
                className="rounded-lg border border-app bg-[color:var(--surface)] px-3 py-2 text-sm"
              >
                <option value="">{t('hq.hierarchy.addDirect')}</option>
                {depotRows
                  .filter((dep) => !d.directDepotIds.includes(dep.id))
                  .map((dep) => (
                    <option key={dep.id} value={dep.id}>
                      {dep.code} · {dep.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function DepotRow({
  depot,
  assistants,
  busy,
  onChange,
}: {
  depot: SupervisedDepot;
  assistants: Customer[];
  busy: boolean;
  onChange: (assistantId: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-app px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {depot.code} · {depot.name}
      </span>
      <select
        value={depot.assistantSupervisorId ?? ''}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-app bg-[color:var(--surface)] px-2 py-1.5 text-sm"
      >
        <option value="">{t('hq.hierarchy.noAssistant')}</option>
        {assistants.map((a) => (
          <option key={a.id} value={a.id}>
            {a.fullName || a.phone}
          </option>
        ))}
      </select>
    </div>
  );
}

function Facts({
  label,
  empty,
  children,
}: {
  label: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <div className="flex flex-wrap gap-2">
        {children.length === 0 ? <span className="text-sm text-muted">{empty}</span> : children}
      </div>
    </div>
  );
}
