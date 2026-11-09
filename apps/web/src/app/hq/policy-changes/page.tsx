'use client';

import { useState } from 'react';
import { ShieldCheck } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';

// AAS-14 - the four-eyes queue. A security-policy or retention change made on those screens waits
// here until a DIFFERENT super admin approves it (which applies it) or rejects it.
interface PolicyChange {
  id: string;
  kind: 'SECURITY_POLICY' | 'RETENTION_POLICY';
  targetId: string | null;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'APPLIED' | 'REJECTED';
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decisionNote: string | null;
}

export default function HqPolicyChangesPage() {
  const { t } = useT();
  const { toast } = useToast();
  const { customer } = useAuth();
  const query = useAsync<PolicyChange[]>(() => api.get(endpoints.admin.policyChanges.list(), true));
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(change: PolicyChange, approve: boolean) {
    setBusyId(change.id);
    try {
      await api.post(
        approve
          ? endpoints.admin.policyChanges.approve(change.id)
          : endpoints.admin.policyChanges.reject(change.id),
        {},
        true,
      );
      toast(t(approve ? 'hq.policyChanges.approved' : 'hq.policyChanges.rejected'), 'success');
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.policyChanges.actionError'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <HqPageHeader
        icon={ShieldCheck}
        title={t('hq.policyChanges.title')}
        subtitle={t('hq.policyChanges.subtitle')}
      />

      {query.loading && <Skeleton className="h-24 w-full" />}
      {query.error && (
        <ErrorState message={t('hq.policyChanges.loadFailed')} onRetry={query.reload} />
      )}
      {query.data && query.data.length === 0 && (
        <p className="text-sm text-muted">{t('hq.policyChanges.empty')}</p>
      )}

      {(query.data ?? []).map((c) => {
        const own = c.requestedBy === customer?.id;
        return (
          <Card key={c.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={c.status === 'PENDING' ? 'brand' : c.status === 'APPLIED' ? 'success' : 'neutral'}>
                {t(`hq.policyChanges.${c.status}`)}
              </Badge>
              <span className="font-semibold">
                {t(c.kind === 'SECURITY_POLICY' ? 'hq.policyChanges.kindSecurity' : 'hq.policyChanges.kindRetention')}
                {c.targetId ? ` - ${c.targetId}` : ''}
              </span>
              <span className="text-xs text-muted">{new Date(c.requestedAt).toLocaleString('id-ID')}</span>
            </div>
            <pre className="overflow-x-auto rounded-md bg-black/5 p-2 text-xs">
              {JSON.stringify(c.payload, null, 2)}
            </pre>
            <p className="text-xs text-muted">
              {t('hq.policyChanges.requestedBy')}: {c.requestedBy}
              {c.decisionNote ? ` · ${c.decisionNote}` : ''}
            </p>
            {c.status === 'PENDING' && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void decide(c, true)} loading={busyId === c.id} disabled={own}>
                  {t('hq.policyChanges.approve')}
                </Button>
                <Button variant="secondary" onClick={() => void decide(c, false)} disabled={own || busyId === c.id}>
                  {t('hq.policyChanges.reject')}
                </Button>
                {own && <span className="text-xs text-muted">{t('hq.policyChanges.own')}</span>}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
