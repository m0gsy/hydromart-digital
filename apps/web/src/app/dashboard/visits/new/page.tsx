'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { AskAiDepotLink } from '@/components/ask-ai-link';
import { PreciseLocationNotice } from '@/components/hr/precise-location-notice';
import { RequireAuth } from '@/components/require-auth';
import { Button, CenterState, ErrorState, Field, FormError, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { currentPosition, GeoError } from '@/lib/geo';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Visit, VisitOverview } from '@/lib/visits';
import type { VisitTemplate } from '@/lib/visit-templates';

const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

function Body() {
  const { t } = useT();
  const router = useRouter();
  const depots = useAsync<VisitOverview>(() => api.get(endpoints.visits.overview, true), []);
  const templates = useAsync<VisitTemplate[]>(
    () => api.get(endpoints.visitTemplates.active, true),
    [],
  );
  const [depotId, setDepotId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server's "already open" refusal names the visit, so it can be resumed from here.
  const [openId, setOpenId] = useState<string | null>(null);

  async function begin() {
    setBusy(true);
    setError(null);
    setOpenId(null);
    try {
      const { coords } = await currentPosition({ precise: true });
      // The server needs the fix's accuracy to apply its "Perkiraan" rule: no figure, no check-in.
      if (!Number.isFinite(coords.accuracy) || coords.accuracy < 0) throw new GeoError('unavailable');
      const accuracyM = Math.round(coords.accuracy);
      const visit = await api.post<Visit>(
        endpoints.visits.start,
        { depotId, templateId, lat: coords.latitude, lng: coords.longitude, accuracyM },
        true,
      );
      router.push(`/dashboard/visits/detail?id=${visit.id}`);
    } catch (e) {
      if (e instanceof GeoError) setError(t(`errors.geo.${e.reason}`));
      else if (e instanceof ApiError) {
        // The refusal text IS the guidance (outside the area, "Perkiraan", no depot point...): verbatim.
        setError(e.message);
        // Only the "already open" refusal names a visit to resume; any other text may carry a uuid.
        setOpenId(
          e.code === 'VISIT_ALREADY_OPEN'
            ? (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(
                e.message,
              )?.[0] ?? null)
            : null,
        );
      } else setError(t('opsFix.visits.new.startFailed'));
      setBusy(false);
    }
  }

  if (depots.loading || templates.loading) return <Skeleton className="h-40 w-full" />;
  if (depots.error || templates.error) {
    return (
      <ErrorState
        message={t('opsFix.visits.new.loadError')}
        onRetry={() => {
          depots.reload();
          templates.reload();
        }}
      />
    );
  }
  const list = templates.data ?? [];

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link
        href="/dashboard/visits"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700"
      >
        {t('opsFix.visits.new.back')}
      </Link>
      <h1 className="text-xl font-bold">{t('opsFix.visits.new.title')}</h1>
      <PreciseLocationNotice />
      <p className="text-sm text-muted">{t('opsFix.visits.new.hint')}</p>
      <Field label={t('opsFix.visits.new.depot')} htmlFor="visit-depot">
        <select
          id="visit-depot"
          className={SELECT}
          value={depotId}
          onChange={(e) => setDepotId(e.target.value)}
        >
          <option value="">{t('opsFix.visits.new.pickDepot')}</option>
          {(depots.data?.depots ?? []).map((d) => (
            <option key={d.depotId} value={d.depotId}>
              {d.depotName}
            </option>
          ))}
        </select>
      </Field>
      {depotId && <AskAiDepotLink depotId={depotId} />}
      <Field label={t('opsFix.visits.new.template')} htmlFor="visit-template">
        <select
          id="visit-template"
          className={SELECT}
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">{t('opsFix.visits.new.pickTemplate')}</option>
          {list.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
            </option>
          ))}
        </select>
      </Field>
      {!list.length && <p className="text-sm text-muted">{t('opsFix.visits.new.noTemplates')}</p>}
      <FormError message={error} />
      {openId && (
        <Link
          href={`/dashboard/visits/detail?id=${openId}`}
          className="block text-sm font-semibold text-brand-700"
        >
          {t('opsFix.visits.new.resumeExisting')}
        </Link>
      )}
      <Button className="w-full" loading={busy} disabled={!depotId || !templateId} onClick={begin}>
        {busy ? t('opsFix.visits.new.locating') : t('opsFix.visits.new.begin')}
      </Button>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  // The page reads the depot overview (visitRead) and starts with visitConduct: a custom role
  // holding only one of them would see an empty form or a 403 after the GPS wait.
  if (!can('visitConduct', customer?.role) || !can('visitRead', customer?.role)) {
    return (
      <CenterState title={t('opsFix.visits.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.visits.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function NewVisitPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
