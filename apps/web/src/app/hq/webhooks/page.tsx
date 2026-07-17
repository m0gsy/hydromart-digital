'use client';

import { useState } from 'react';
import { Plugs, Trash } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, Chip, ErrorState, Field, IconButton, Input, Skeleton, Toggle } from '@/components/ui';
import { Sheet, ConfirmDialog } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { WebhookEndpoint } from '@/lib/types';

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
  if (query.error) return <ErrorState message={t('hq.webhooks.loadError')} onRetry={query.reload} />;

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
                  <IconButton aria-label={t('hq.webhooks.delete')} onClick={() => setDeleteTarget(w)}>
                    <Trash size={18} />
                  </IconButton>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {w.events.map((e) => (
                  <Chip key={e} tone="outline">{e}</Chip>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

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

  const eventList = events.split(',').map((s) => s.trim()).filter(Boolean);
  const valid = /^https?:\/\//.test(url.trim()) && eventList.length > 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.admin.webhooks.create, { url: url.trim(), events: eventList }, true);
      setUrl('');
      setEvents('');
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
        <Field label={t('hq.webhooks.url')} htmlFor="wh-url">
          <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://partner.example.com/hooks" />
        </Field>
        <Field label={t('hq.webhooks.events')} htmlFor="wh-events" hint={t('hq.webhooks.eventsHint')}>
          <Input id="wh-events" value={events} onChange={(e) => setEvents(e.target.value)} placeholder="order.created, payment.settled" />
        </Field>
        {error && <p className="text-sm text-[color:var(--danger)]" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('hq.common.cancel')}</Button>
          <Button onClick={submit} disabled={!valid} loading={busy}>{t('hq.webhooks.add')}</Button>
        </div>
      </div>
    </Sheet>
  );
}
