'use client';

import { Plugs } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, Chip } from '@/components/ui';
import { useToast } from '@/components/toast';
import { WEBHOOKS_STUB } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 19c — webhook subscriptions. No webhook service, so endpoints are stubbed; add
// just toasts.
export default function HqWebhooksPage() {
  const { t } = useT();
  const { toast } = useToast();

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Plugs}
        title={t('hq.webhooks.title')}
        subtitle={t('hq.webhooks.subtitle')}
        stub
        action={<Button onClick={() => toast(t('hq.webhooks.added'), 'success')}>{t('hq.webhooks.add')}</Button>}
      />

      <div className="flex flex-col gap-3">
        {WEBHOOKS_STUB.map((w) => (
          <Card key={w.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="min-w-0 truncate text-sm font-semibold">{w.url}</code>
              <Badge tone={w.delivery >= 99 ? 'success' : 'warning'}>
                {t('hq.webhooks.delivery')} {w.delivery.toFixed(1)}%
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {w.events.map((e) => (
                <Chip key={e} tone="outline">{e}</Chip>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
