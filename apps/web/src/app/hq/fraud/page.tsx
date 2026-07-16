'use client';

import { useState } from 'react';
import { ShieldWarning } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, Chip } from '@/components/ui';
import { useToast } from '@/components/toast';
import { FRAUD_QUEUE_STUB, type FraudRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 15b — fraud & risk queue. No risk-scoring service, so flagged items are stubbed;
// review / block optimistically drop the row + toast.
function scoreTone(score: number): 'danger' | 'warning' | 'neutral' {
  if (score >= 80) return 'danger';
  if (score >= 60) return 'warning';
  return 'neutral';
}

export default function HqFraudPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [queue, setQueue] = useState<FraudRow[]>(FRAUD_QUEUE_STUB);

  function decide(r: FraudRow, blocked: boolean) {
    setQueue((q) => q.filter((x) => x.id !== r.id));
    toast(
      blocked ? t('hq.fraud.blocked', { subject: r.subject }) : t('hq.fraud.reviewed', { subject: r.subject }),
      blocked ? 'error' : 'success',
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={ShieldWarning} title={t('hq.fraud.title')} subtitle={t('hq.fraud.subtitle')} stub />

      {queue.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.fraud.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {[...queue].sort((a, b) => b.score - a.score).map((r) => (
            <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{r.subject}</span>
                  <Chip tone="outline">{t(`hq.fraud.type.${r.type}`)}</Chip>
                  <Badge tone={scoreTone(r.score)}>
                    {t('hq.fraud.score')} {r.score}
                  </Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {r.signals.map((s) => (
                    <Chip key={s} tone="amber">{s}</Chip>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => decide(r, false)}>
                  {t('hq.fraud.review')}
                </Button>
                <Button variant="danger" onClick={() => decide(r, true)}>
                  {t('hq.fraud.block')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
