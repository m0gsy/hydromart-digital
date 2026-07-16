'use client';

import { useState } from 'react';
import { Key } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, Chip } from '@/components/ui';
import { useToast } from '@/components/toast';
import { API_KEYS_STUB, agoLabel, type ApiKeyRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 13d — service API credentials. No key-management service, so keys are stubbed;
// rotate / revoke / create just toast.
export default function HqApiKeysPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyRow[]>(API_KEYS_STUB);

  function revoke(k: ApiKeyRow) {
    setKeys((prev) => prev.filter((x) => x.id !== k.id));
    toast(t('hq.apiKeys.revoked', { name: k.name }), 'info');
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Key}
        title={t('hq.apiKeys.title')}
        subtitle={t('hq.apiKeys.subtitle')}
        stub
        action={<Button onClick={() => toast(t('hq.apiKeys.created'), 'success')}>{t('hq.apiKeys.create')}</Button>}
      />

      {keys.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.apiKeys.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map((k) => (
            <Card key={k.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{k.name}</span>
                  <code className="rounded bg-[color:var(--surface-soft)] px-1.5 py-0.5 text-xs">{k.prefix}…</code>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {k.scopes.map((s) => (
                    <Chip key={s} tone="outline">{s}</Chip>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t('hq.apiKeys.lastUsed')}: {agoLabel(k.lastUsedAgoMin, t)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => toast(t('hq.apiKeys.rotated', { name: k.name }), 'success')}>
                  {t('hq.apiKeys.rotate')}
                </Button>
                <Button variant="danger" onClick={() => revoke(k)}>
                  {t('hq.apiKeys.revoke')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
