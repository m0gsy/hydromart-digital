'use client';

import { useState } from 'react';
import { Plugs, Trash } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  IconButton,
  Input,
  Skeleton,
  Toggle,
} from '@/components/ui';
import { Sheet, ConfirmDialog } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { WebhookDelivery, WebhookEndpoint } from '@/lib/types';

// Design 19c — webhook subscriptions. Real admin-service track: SUPER_ADMIN CRUD. Delivery
// rate/status are stored fields updated by future delivery attempts; null until a real
// delivery is recorded, so we label them honestly rather than fabricating a "live" number.
export default function HqWebhooksPage() {
  const { t } = useT();
  const { toast } = useToast();
  const query = useAsync<WebhookEndpoint[]>(() => api.get(endpoints.admin.webhooks.list, true));
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpoint | null>(null);
  const [busy, setBusy] = useState(false);

  if (query.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error)
    return <ErrorState message={t('hq.webhooks.loadError')} onRetry={query.reload} />;

  const hooks = query.data ?? [];

  async function toggle(w: WebhookEndpoint, active: boolean) {
    try {
      await api.patch(endpoints.admin.webhooks.update(w.id), { active }, true);
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.webhooks.saveError'), 'error');
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.del(endpoints.admin.webhooks.remove(deleteTarget.id), true);
      toast(t('hq.webhooks.deletedOk'), 'info');
      setDeleteTarget(null);
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.webhooks.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Plugs}
        title={t('hq.webhooks.title')}
        subtitle={t('hq.webhooks.subtitle')}
        action={<Button onClick={() => setCreating(true)}>{t('hq.webhooks.add')}</Button>}
      />

      {/* H-30: what the operator is actually handing a partner — the header, the scopes,
          and what happens on failure. Written down here because the alternative is an
          operator guessing at an integration contract. */}
      <Card className="p-4">
        <p className="text-sm text-muted">{t('hq.webhooks.howItWorks')}</p>
      </Card>

      {hooks.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.webhooks.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {hooks.map((w) => (
            <Card key={w.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="min-w-0 truncate text-sm font-semibold">{w.url}</code>
                <div className="flex items-center gap-2">
                  {w.deliveryRatePct === null ? (
                    <Badge tone="neutral">{t('hq.webhooks.deliveryNone')}</Badge>
                  ) : (
                    <Badge tone={w.deliveryRatePct >= 99 ? 'success' : 'warning'}>
                      {t('hq.webhooks.delivery')} {w.deliveryRatePct}%
                    </Badge>
                  )}
                  <Toggle on={w.active} onChange={(v) => toggle(w, v)} label={w.url} />
                  <IconButton
                    aria-label={t('hq.webhooks.delete')}
                    onClick={() => setDeleteTarget(w)}
                  >
                    <Trash size={18} />
                  </IconButton>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {w.events.map((e) => (
                  <Chip key={e} tone="outline">
                    {e}
                  </Chip>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <DeliveryLog />

      <CreateWebhookSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast(t('hq.webhooks.addedOk'), 'success');
          query.reload();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('hq.webhooks.deleteTitle')}
        message={t('hq.webhooks.deleteMsg', { url: deleteTarget?.url ?? '' })}
        confirmLabel={t('hq.webhooks.delete')}
        cancelLabel={t('hq.common.cancel')}
        loading={busy}
        onConfirm={remove}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function CreateWebhookSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventList = events
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = /^https?:\/\//.test(url.trim()) && eventList.length > 0;

  // Shown once after a successful create; the sheet stays open until it is dismissed.
  const [secret, setSecret] = useState<string | null>(null);

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * CA-2-37: the signing secret comes back HERE and nowhere else.
       *
       * Every webhook registered from this sheet used to go out unsigned, forever — the
       * server signs only when the endpoint has a secret, and this call never sent or
       * received one. The receiver had no way to tell our POST from anyone else's, and a
       * URL is not a credential: anyone who learns it can forge deliveries.
       *
       * The server generates one now. It is readable exactly once, so it is shown rather
       * than the sheet closing on it — closing would leave the partner with an endpoint
       * they cannot verify and no way to ask for the key again.
       */
      const created = await api.post<{ secret: string }>(
        endpoints.admin.webhooks.create,
        { url: url.trim(), events: eventList },
        true,
      );
      setUrl('');
      setEvents('');
      setSecret(created.secret);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.webhooks.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('hq.webhooks.createTitle')}>
      <div className="flex flex-col gap-4">
        {secret && (
          <div className="rounded-xl border border-app bg-amber-50 p-3.5">
            <p className="text-sm font-bold text-amber-900">{t('hq.webhooks.secretTitle')}</p>
            <p className="mt-1 text-xs text-amber-800">{t('hq.webhooks.secretBody')}</p>
            <code className="mt-2 block break-all rounded-lg bg-white px-2.5 py-2 font-mono text-xs">
              {secret}
            </code>
          </div>
        )}
        <Field label={t('hq.webhooks.url')} htmlFor="wh-url">
          <Input
            id="wh-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://partner.example.com/hooks"
          />
        </Field>
        <Field
          label={t('hq.webhooks.events')}
          htmlFor="wh-events"
          hint={t('hq.webhooks.eventsHint')}
        >
          <Input
            id="wh-events"
            value={events}
            onChange={(e) => setEvents(e.target.value)}
            placeholder="order.created, payment.settled"
          />
        </Field>
        {error && (
          <p className="text-sm text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('hq.common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!valid} loading={busy}>
            {t('hq.webhooks.add')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * CA-2-43 — the delivery log, and the button that sends one again.
 *
 * `GET /webhooks/deliveries` and `POST /webhooks/deliveries/:id/replay` shipped with the
 * dispatcher and were unit-tested, and nothing in the console ever called either. So a
 * partner asking "did you send us that order?" could only be answered by hand out of the
 * database, and a delivery that went DEAD after its six retries stayed dead — the replay
 * it was given had no door.
 *
 * Its own read, and its own error: a failed log must not take the endpoint list down with
 * it, because the list is what an operator came here to manage.
 */
const STATUS_TONE = {
  DELIVERED: 'success',
  PENDING: 'brand',
  FAILED: 'warning',
  DEAD: 'danger',
} as const;

function DeliveryLog() {
  const { t } = useT();
  const { toast } = useToast();
  const query = useAsync<WebhookDelivery[]>(() =>
    api.get(endpoints.admin.webhooks.deliveries({ limit: 50 }), true),
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  async function replay(d: WebhookDelivery) {
    setBusyId(d.id);
    try {
      await api.post(endpoints.admin.webhooks.replay(d.id), undefined, true);
      toast(t('hq.webhooks.logReplayed'), 'success');
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.webhooks.logReplayError'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  const rows = query.data ?? [];

  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="text-sm font-extrabold">{t('hq.webhooks.logTitle')}</p>
      {query.loading && <Skeleton className="h-24 w-full" />}
      {query.error && <ErrorState message={t('hq.webhooks.logError')} onRetry={query.reload} />}
      {!query.loading && !query.error && rows.length === 0 && (
        <p className="text-sm text-muted">{t('hq.webhooks.logEmpty')}</p>
      )}
      {rows.map((d) => (
        <div
          key={d.id}
          className="flex flex-col gap-2 border-t border-app pt-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{d.event}</p>
            <p className="text-xs text-muted">
              {formatDateTime(d.occurredAt)} · {t('hq.webhooks.logAttempts', { n: d.attempts })}
              {d.responseStatus !== null ? ` · HTTP ${d.responseStatus}` : ''}
              {/*
               * The reason it failed is the whole value of a log: without it an operator
               * can only press the button again and hope.
               *
               * Part of the meta line rather than its own alert region, and deliberately
               * so: this is a recorded fact about something that already happened, and a
               * screen reader announcing every historical row as a live error would be
               * wrong. The a11y gate caught the first draft doing exactly that.
               */}
              {d.lastError ? (
                <span className="block truncate">
                  {t('hq.webhooks.logReason')} {d.lastError}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2.5">
            <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
            {d.status !== 'DELIVERED' && (
              <Button variant="secondary" onClick={() => replay(d)} loading={busyId === d.id}>
                {t('hq.webhooks.logReplay')}
              </Button>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}
