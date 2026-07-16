'use client';

import { useState } from 'react';
import { Key } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, Chip, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { Sheet, ConfirmDialog } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { agoLabel } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ApiKey, ApiKeyEnvironment, CreatedApiKey } from '@/lib/types';

// Design 13d — service API credentials. Real admin-service track: SUPER_ADMIN CRUD.
// The full secret is shown ONCE on create/rotate; the list only shows the prefix.
function minutesAgo(iso: string | null): number | null {
  return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)) : null;
}

export default function HqApiKeysPage() {
  const { t } = useT();
  const { toast } = useToast();
  const keysQuery = useAsync<ApiKey[]>(() => api.get(endpoints.admin.apiKeys.list, true));
  const [creating, setCreating] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<CreatedApiKey | null>(null);

  if (keysQuery.loading) return <Skeleton className="h-96 w-full" />;
  if (keysQuery.error) return <ErrorState message={t('hq.apiKeys.loadError')} onRetry={keysQuery.reload} />;

  const keys = keysQuery.data ?? [];

  async function rotate() {
    if (!rotateTarget) return;
    setBusy(true);
    try {
      const created = await api.post<CreatedApiKey>(endpoints.admin.apiKeys.rotate(rotateTarget.id), {}, true);
      setRotateTarget(null);
      setReveal(created);
      toast(t('hq.apiKeys.rotatedOk', { name: created.name }), 'success');
      keysQuery.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.apiKeys.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await api.del(endpoints.admin.apiKeys.revoke(revokeTarget.id), true);
      toast(t('hq.apiKeys.revokedOk', { name: revokeTarget.name }), 'info');
      setRevokeTarget(null);
      keysQuery.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.apiKeys.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Key}
        title={t('hq.apiKeys.title')}
        subtitle={t('hq.apiKeys.subtitle')}
        action={<Button onClick={() => setCreating(true)}>{t('hq.apiKeys.create')}</Button>}
      />

      {keys.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.apiKeys.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map((k) => {
            const revoked = k.revokedAt !== null;
            const usedMin = minutesAgo(k.lastUsedAt);
            return (
              <Card key={k.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{k.name}</span>
                    <code className="rounded bg-[color:var(--surface-soft)] px-1.5 py-0.5 text-xs">{k.keyPrefix}…</code>
                    <Badge tone={k.environment === 'PROD' ? 'success' : 'warning'}>
                      {t(`hq.apiKeys.env.${k.environment}`)}
                    </Badge>
                    {revoked && <Badge tone="danger">{t('hq.apiKeys.revokedLabel')}</Badge>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {k.scopes.map((s) => (
                      <Chip key={s} tone="outline">{s}</Chip>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {t('hq.apiKeys.lastUsed')}: {usedMin === null ? t('hq.apiKeys.never') : agoLabel(usedMin, t)}
                  </p>
                </div>
                {!revoked && (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setRotateTarget(k)}>
                      {t('hq.apiKeys.rotate')}
                    </Button>
                    <Button variant="danger" onClick={() => setRevokeTarget(k)}>
                      {t('hq.apiKeys.revoke')}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <CreateKeySheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          setReveal(created);
          toast(t('hq.apiKeys.createdOk', { name: created.name }), 'success');
          keysQuery.reload();
        }}
      />

      {/* One-time secret reveal */}
      <Sheet open={reveal !== null} onClose={() => setReveal(null)} title={t('hq.apiKeys.tokenTitle')}>
        {reveal && <TokenReveal token={reveal.token} onDone={() => setReveal(null)} />}
      </Sheet>

      <ConfirmDialog
        open={rotateTarget !== null}
        title={t('hq.apiKeys.rotateTitle')}
        message={t('hq.apiKeys.rotateMsg', { name: rotateTarget?.name ?? '' })}
        confirmLabel={t('hq.apiKeys.rotate')}
        cancelLabel={t('hq.common.cancel')}
        tone="primary"
        loading={busy}
        onConfirm={rotate}
        onClose={() => setRotateTarget(null)}
      />
      <ConfirmDialog
        open={revokeTarget !== null}
        title={t('hq.apiKeys.revokeTitle')}
        message={t('hq.apiKeys.revokeMsg', { name: revokeTarget?.name ?? '' })}
        confirmLabel={t('hq.apiKeys.revoke')}
        cancelLabel={t('hq.common.cancel')}
        loading={busy}
        onConfirm={revoke}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}

function CreateKeySheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: CreatedApiKey) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('');
  const [environment, setEnvironment] = useState<ApiKeyEnvironment>('PROD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeList = scopes.split(',').map((s) => s.trim()).filter(Boolean);
  const valid = name.trim().length > 0 && scopeList.length > 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<CreatedApiKey>(
        endpoints.admin.apiKeys.create,
        { name: name.trim(), scopes: scopeList, environment },
        true,
      );
      setName('');
      setScopes('');
      setEnvironment('PROD');
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.apiKeys.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('hq.apiKeys.createTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('hq.apiKeys.name')} htmlFor="key-name">
          <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('hq.apiKeys.namePlaceholder')} />
        </Field>
        <Field label={t('hq.apiKeys.scopes')} htmlFor="key-scopes" hint={t('hq.apiKeys.scopesHint')}>
          <Input id="key-scopes" value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="payments:read, payments:write" />
        </Field>
        <Field label={t('hq.apiKeys.environment')}>
          <div className="flex overflow-hidden rounded-full border border-app text-xs font-bold">
            {(['PROD', 'STAGING'] as ApiKeyEnvironment[]).map((env) => (
              <button
                key={env}
                type="button"
                onClick={() => setEnvironment(env)}
                aria-pressed={environment === env}
                className={`px-4 py-1.5 transition-colors ${environment === env ? 'bg-brand-600 text-on-brand' : 'text-muted hover:bg-[color:var(--surface-soft)]'}`}
              >
                {t(`hq.apiKeys.env.${env}`)}
              </button>
            ))}
          </div>
        </Field>
        {error && <p className="text-sm text-[color:var(--danger)]" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('hq.common.cancel')}</Button>
          <Button onClick={submit} disabled={!valid} loading={busy}>{t('hq.apiKeys.create')}</Button>
        </div>
      </div>
    </Sheet>
  );
}

function TokenReveal({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-2xl bg-[color:var(--warning-bg)] p-3 text-sm text-[color:var(--warning)]">
        {t('hq.apiKeys.tokenWarn')}
      </p>
      <code className="block break-all rounded-lg border border-app bg-[color:var(--surface-soft)] p-3 text-sm">{token}</code>
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token);
              toast(t('hq.apiKeys.copied'), 'success');
            } catch {
              toast(t('hq.apiKeys.saveError'), 'error');
            }
          }}
        >
          {t('hq.apiKeys.copy')}
        </Button>
        <Button onClick={onDone}>{t('hq.apiKeys.done')}</Button>
      </div>
    </div>
  );
}
