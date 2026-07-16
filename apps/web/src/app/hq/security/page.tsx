'use client';

import { useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, Skeleton, Toggle } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { agoLabel } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { AdminSession, SecurityPolicy } from '@/lib/types';

// Design 19b — security & 2FA. Both the POLICY (admin-service GET/PUT /security-policy)
// and the ACTIVE SESSIONS list (auth-service GET /sessions for the current user, with
// per-session revoke) are real. No geo lookup, so sessions show device + IP, not city.
export default function HqSecurityPage() {
  const { t } = useT();
  const { toast } = useToast();
  const query = useAsync<SecurityPolicy>(() => api.get(endpoints.admin.security, true));
  const sessionsQ = useAsync<AdminSession[]>(() => api.get(endpoints.auth.sessions, true));
  const [draft, setDraft] = useState<SecurityPolicy | null>(null);
  const [allowlistText, setAllowlistText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  if (query.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error) return <ErrorState message={t('hq.security.loadError')} onRetry={query.reload} />;

  const policy = draft ?? query.data!;
  const allowlist = allowlistText ?? policy.ipAllowlist.join('\n');
  const set = (patch: Partial<SecurityPolicy>) => setDraft({ ...policy, ...patch });

  async function save() {
    setBusy(true);
    const ipAllowlist = allowlist.split('\n').map((s) => s.trim()).filter(Boolean);
    try {
      const saved = await api.put<SecurityPolicy>(
        endpoints.admin.security,
        { idleTimeoutMinutes: policy.idleTimeoutMinutes, require2fa: policy.require2fa, ipAllowlist },
        true,
      );
      setDraft(saved);
      setAllowlistText(saved.ipAllowlist.join('\n'));
      toast(t('hq.security.saved'), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.security.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(s: AdminSession) {
    setRevoking(s.id);
    try {
      await api.post(endpoints.auth.revokeSession(s.id), {}, true);
      toast(t('hq.security.revoked'), 'info');
      sessionsQ.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.security.saveError'), 'error');
    } finally {
      setRevoking(null);
    }
  }

  const sessions = sessionsQ.data ?? [];
  const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Lock} title={t('hq.security.title')} subtitle={t('hq.security.subtitle')} />

      <Card className="flex flex-col gap-4 p-5">
        <p className="text-sm font-extrabold">{t('hq.security.sessionPolicy')}</p>
        <div className="flex items-center justify-between gap-4 border-b border-[color:var(--border-soft)] pb-3">
          <label htmlFor="idle" className="text-sm text-muted">{t('hq.security.sessionTimeout')}</label>
          <div className="flex items-center gap-2">
            <input
              id="idle"
              type="number"
              min={1}
              max={1440}
              value={policy.idleTimeoutMinutes}
              onChange={(e) => set({ idleTimeoutMinutes: Number(e.target.value) })}
              className="surface-elevated w-20 rounded-lg border border-app px-2.5 py-1.5 text-sm font-semibold tabular-nums focus:outline focus:outline-2 focus:outline-brand-600"
            />
            <span className="text-sm text-muted">{t('hq.security.minutesIdle')}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('hq.security.twoFa')}</p>
            <p className="text-xs text-muted">{t('hq.security.twoFaBody')}</p>
          </div>
          <Toggle on={policy.require2fa} onChange={(v) => set({ require2fa: v })} label={t('hq.security.twoFa')} />
        </div>
        <div>
          <label htmlFor="ips" className="text-sm font-semibold">
            {t('hq.security.ipAllowlist')}
          </label>
          <textarea
            id="ips"
            value={allowlist}
            onChange={(e) => setAllowlistText(e.target.value)}
            rows={3}
            className="surface-elevated mt-1.5 w-full rounded-lg border border-app px-3.5 py-2.5 font-mono text-xs focus:outline focus:outline-2 focus:outline-brand-600"
          />
          <p className="mt-1 text-xs text-muted">{t('hq.security.ipHint')}</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} loading={busy}>{t('hq.security.save')}</Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <p className="text-sm font-extrabold">{t('hq.security.sessionsTitle')}</p>
        <p className="mb-1 text-xs text-muted">{t('hq.security.sessionsNote')}</p>
        {sessionsQ.loading ? (
          <Skeleton className="h-20 w-full" />
        ) : sessionsQ.error ? (
          <ErrorState message={sessionsQ.error} onRetry={sessionsQ.reload} />
        ) : sessions.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted">{t('hq.security.sessionsEmpty')}</p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 border-b border-[color:var(--border-soft)] py-2.5 last:border-0">
              <div className="min-w-0">
                <span className="text-sm font-semibold">{s.userAgent || t('hq.security.unknownDevice')}</span>
                <p className="text-xs text-muted">
                  {(s.ipAddress || t('hq.common.dash')) + ' · ' + agoLabel(minutesAgo(s.createdAt), t)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(s)}
                disabled={revoking === s.id}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger-bg)] disabled:opacity-50"
              >
                {t('hq.security.revoke')}
              </button>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
