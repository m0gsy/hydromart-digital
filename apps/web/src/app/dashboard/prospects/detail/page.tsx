'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { ExternalLink } from '@/components/external-link';
import { useConfirm } from '@/components/confirm';
import { AssignForm } from '@/components/prospects/assign-form';
import { OwnerDepotForm } from '@/components/prospects/owner-depot-form';
import { saveError } from '@/components/prospects/save-error';
import { StatusForm } from '@/components/prospects/status-form';
import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, FormError, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { formatDate, formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { DNC_REASONS, labelKey, mapsUrl, STATUS_TONE } from '@/lib/prospect-labels';
import { isTerminal, statusTargets } from '@/lib/prospect-status';
import { can } from '@/lib/roles';
import type { ProspectAssignee, ProspectDetail } from '@/lib/types';
import { useQueryParam } from '@/lib/use-query-param';

type Panel = 'status' | 'assign' | 'owner' | 'convert' | 'dnc' | null;
const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Body() {
  const { t } = useT();
  const { customer } = useAuth();
  const { depots } = useDepot();
  const { confirm } = useConfirm();
  const id = useQueryParam('id');
  const role = customer?.role;
  const manage = can('b2bProspectManage', role);
  const reassign = can('b2bProspectReassign', role);

  const [row, setRow] = useState<ProspectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ status: number | null } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [customerId, setCustomerId] = useState('');
  const [needCustomer, setNeedCustomer] = useState(false);
  const [dncReason, setDncReason] = useState<string>('PROSPECT_REFUSED');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setFailure(null);
    api
      .get<ProspectDetail>(endpoints.prospects.detail(id), true)
      .then((r) => {
        setRow(r);
        setPanel(null);
        setError(null);
      })
      .catch((e) => setFailure({ status: e instanceof ApiError ? e.status : null }))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(load, [load]);

  const ownerDepotId = row?.ownerDepotId ?? null;
  const hasAssignee = row?.assignedToId != null;
  useEffect(() => {
    if (!manage || !ownerDepotId || !hasAssignee) return;
    api
      .get<ProspectAssignee[]>(endpoints.prospects.assignees(ownerDepotId), true)
      .then((list) => setNames(new Map(list.map((s) => [s.id, s.name]))))
      .catch(() => undefined);
  }, [manage, ownerDepotId, hasAssignee]);

  const merge = (updated: ProspectDetail) => {
    setRow((prev) => ({ ...updated, visits: prev?.visits }));
    setPanel(null);
    setError(null);
  };

  async function reopen(current: ProspectDetail) {
    setBusy(true);
    setError(null);
    try {
      merge(
        await api.patch<ProspectDetail>(
          endpoints.prospects.status(current.id),
          { status: 'NEW', seenUpdatedAt: current.updatedAt },
          true,
        ),
      );
    } catch (e) {
      setError(saveError(e, t).message);
    } finally {
      setBusy(false);
    }
  }

  async function convert(current: ProspectDetail) {
    setBusy(true);
    setError(null);
    try {
      merge(
        await api.post<ProspectDetail>(
          endpoints.prospects.convert(current.id),
          customerId.trim() ? { customerId: customerId.trim() } : {},
          true,
        ),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setNeedCustomer(true);
      setError(saveError(e, t).message);
    } finally {
      setBusy(false);
    }
  }

  async function doNotContact(current: ProspectDetail) {
    if (
      !(await confirm({
        title: t('opsFix.prospects.dncForm.confirmTitle'),
        message: t('opsFix.prospects.dncForm.confirmBody'),
        confirmLabel: t('opsFix.prospects.dncForm.confirm'),
        tone: 'danger',
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.prospects.doNotContact(current.id), { reason: dncReason }, true);
      load();
    } catch (e) {
      setError(saveError(e, t).message);
    } finally {
      setBusy(false);
    }
  }

  if (!id || failure?.status === 404) {
    return (
      <CenterState title={t('opsFix.prospects.detail.notFound')}>{t('opsFix.prospects.detail.notFoundBody')}</CenterState>
    );
  }
  if (failure?.status === 403) {
    return (
      <CenterState title={t('opsFix.prospects.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.prospects.gateBody')}
      </CenterState>
    );
  }
  if (failure) return <ErrorState message={t('opsFix.prospects.detail.loadFailed')} onRetry={load} />;
  if (loading && !row) return <Skeleton className="m-4 h-64" />;
  if (!row) return null;

  const none = t('opsFix.prospects.detail.none');
  const depot = depots.find((d) => d.id === row.ownerDepotId);
  const assignee = row.assignedToId
    ? row.assignedToId === customer?.id
      ? t('opsFix.prospects.me')
      : (names.get(row.assignedToId) ?? t('opsFix.prospects.otherStaff'))
    : t('opsFix.prospects.unassigned');
  const terminal = isTerminal(row.status);
  const open = (p: Exclude<Panel, null>) => {
    setError(null);
    setPanel(panel === p ? null : p);
  };
  const forms = {
    onDone: merge,
    onStale: load,
    onCancel: () => setPanel(null),
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <Link href="/dashboard/prospects" className="text-sm font-semibold text-brand-700">
        {t('opsFix.prospects.detail.back')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{row.name}</h1>
          <p className="text-sm text-muted">{t(labelKey('category', row.category))}</p>
        </div>
        <Badge tone={STATUS_TONE[row.status]}>{t(labelKey('status', row.status))}</Badge>
      </div>

      <Card className="p-4" elevated={false}>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Row label={t('opsFix.prospects.detail.address')}>{row.address ?? none}</Row>
          <Row label={t('opsFix.prospects.detail.phone')}>
            {row.phoneE164 ? (
              <a href={`tel:${row.phoneE164}`} className="font-semibold text-brand-700">
                {row.phoneE164}
              </a>
            ) : (
              none
            )}
          </Row>
          <Row label={t('opsFix.prospects.detail.contact')}>{row.contactName ?? none}</Row>
          <Row label={t('opsFix.prospects.detail.note')}>{row.note ?? none}</Row>
          <Row label={t('opsFix.prospects.detail.source')}>
            {t(labelKey('source', row.source))}
            {row.sourceDataset ? ` (${row.sourceDataset})` : ''}
          </Row>
          <Row label={t('opsFix.prospects.detail.licence')}>{row.licence ?? none}</Row>
          <Row label={t('opsFix.prospects.detail.sourceId')}>{row.sourceId ?? none}</Row>
          <Row label={t('opsFix.prospects.detail.sourceDate')}>{row.sourceDate ? formatDate(row.sourceDate) : none}</Row>
          <Row label={t('opsFix.prospects.detail.ownerDepot')}>
            {depot ? `${depot.code} - ${depot.name}` : t('opsFix.prospects.noDepot')}
            {` (${row.ownerSource === 'HQ' ? t('opsFix.prospects.detail.ownerHq') : t('opsFix.prospects.detail.ownerAuto')})`}
          </Row>
          <Row label={t('opsFix.prospects.detail.assignee')}>{assignee}</Row>
          {row.convertedAt && <Row label={t('opsFix.prospects.detail.convertedAt')}>{formatDateTime(row.convertedAt)}</Row>}
          {row.lostReason && <Row label={t('opsFix.prospects.detail.lostReason')}>{row.lostReason}</Row>}
          <Row label={t('opsFix.prospects.detail.lastActivity')}>
            {row.lastActivityAt ? formatDateTime(row.lastActivityAt) : none}
          </Row>
        </dl>
        <div className="mt-3">
          <ExternalLink href={mapsUrl(row.latitude, row.longitude)} className="text-sm font-semibold text-brand-700 underline">
            {t('opsFix.prospects.detail.navigate')}
          </ExternalLink>
        </div>
      </Card>

      {!terminal && (
        <Card className="flex flex-col gap-3 p-4" elevated={false}>
          <div className="flex flex-wrap gap-2">
            {row.status !== 'LOST' && statusTargets(row.status, manage).length > 0 && (
              <Button variant="secondary" onClick={() => open('status')}>
                {t('opsFix.prospects.actions.status')}
              </Button>
            )}
            {row.status === 'LOST' && manage && (
              <Button variant="secondary" loading={busy} onClick={() => reopen(row)}>
                {t('opsFix.prospects.actions.reopen')}
              </Button>
            )}
            {manage && row.ownerDepotId && (
              <Button variant="secondary" onClick={() => open('assign')}>
                {t('opsFix.prospects.actions.assign')}
              </Button>
            )}
            {reassign && (
              <Button variant="secondary" onClick={() => open('owner')}>
                {t('opsFix.prospects.actions.ownerDepot')}
              </Button>
            )}
            {(row.status === 'VISITED' || row.status === 'INTERESTED') && (
              <Button variant="secondary" onClick={() => open('convert')}>
                {t('opsFix.prospects.actions.convert')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => open('dnc')}>
              {t('opsFix.prospects.actions.dnc')}
            </Button>
          </div>
          {panel === 'status' && <StatusForm row={row} manage={manage} {...forms} />}
          {panel === 'assign' && <AssignForm row={row} {...forms} />}
          {panel === 'owner' && <OwnerDepotForm row={row} {...forms} />}
          {panel === 'convert' && (
            <div className="flex flex-col gap-3">
              {(!row.phoneE164 || needCustomer) && (
                <Field label={t('opsFix.prospects.convertForm.customerId')} hint={t('opsFix.prospects.convertForm.needsCustomer')} htmlFor="prospect-customer-id">
                  <Input id="prospect-customer-id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
                </Field>
              )}
              <div className="flex gap-2">
                <Button loading={busy} onClick={() => convert(row)}>
                  {t('opsFix.prospects.actions.convert')}
                </Button>
                <Button variant="secondary" onClick={() => setPanel(null)}>
                  {t('opsFix.prospects.actions.cancel')}
                </Button>
              </div>
            </div>
          )}
          {panel === 'dnc' && (
            <div className="flex flex-col gap-3">
              <Field label={t('opsFix.prospects.dncForm.reason')} htmlFor="prospect-dnc-reason">
                <select id="prospect-dnc-reason" className={SELECT} value={dncReason} onChange={(e) => setDncReason(e.target.value)}>
                  {DNC_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(labelKey('dnc', r))}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex gap-2">
                <Button variant="danger" loading={busy} onClick={() => doNotContact(row)}>
                  {t('opsFix.prospects.actions.dnc')}
                </Button>
                <Button variant="secondary" onClick={() => setPanel(null)}>
                  {t('opsFix.prospects.actions.cancel')}
                </Button>
              </div>
            </div>
          )}
          <FormError message={panel === 'status' || panel === 'assign' || panel === 'owner' ? null : error} />
        </Card>
      )}
      {terminal && <FormError message={error} />}

      <Card className="p-4" elevated={false}>
        <h2 className="mb-2 text-sm font-semibold">{t('opsFix.prospects.detail.visits')}</h2>
        {row.visits?.length ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {row.visits.map((v) => (
              <li key={v.id}>
                {formatDate(v.visitedAt)}: {t(labelKey('outcome', v.outcome))},{' '}
                {t('opsFix.prospects.detail.distance', { m: Math.round(v.distanceM) })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('opsFix.prospects.detail.noVisits')}</p>
        )}
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  // GET /:id is Work: a Read-only role (Direksi) never calls it.
  if (!can('b2bProspectWork', customer?.role)) {
    return (
      <CenterState title={t('opsFix.prospects.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.prospects.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ProspectDetailPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
