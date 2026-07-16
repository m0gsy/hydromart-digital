'use client';

import { useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, Skeleton, Toggle } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { ACTIVE_SESSIONS_STUB, agoLabel, StubBadge, type SessionRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { SecurityPolicy } from '@/lib/types';

// Design 19b — security & 2FA. The POLICY is real admin-service track: GET/PUT
// /security-policy (idle timeout, require-2FA, IP allowlist). The "active sessions" list has
// NO source here (sessions live in auth-service) so it stays clearly badged as sample data.
export default function HqSecurityPage() {
  const { t } = useT();
  const { toast } = useToast();
  const query = useAsync<SecurityPolicy>(() => api.get(endpoints.admin.security, true));
  const [draft, setDraft] = useState<SecurityPolicy | null>(null);
  const [allowlistText, setAllowlistText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>(ACTIVE_SESSIONS_STUB);

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

  function revoke(s: SessionRow) {
    setSessions((prev) => prev.filter((x) => x.id !== s.id));
    toast(t('hq.security.revoked'), 'info');
  }

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
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-extrabold">{t('hq.security.sessionsTitle')}</p>
          <StubBadge />
        </div>
        <p className="mb-1 text-xs text-muted">{t('hq.security.sessionsNote')}</p>
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 border-b border-[color:var(--border-soft)] py-2.5 last:border-0">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{s.device}</span>
                {s.current && <Badge tone="brand">{t('hq.security.current')}</Badge>}
              </div>
              <p className="text-xs text-muted">
                {s.location} · {s.ip} · {agoLabel(s.agoMin, t)}
              </p>
            </div>
            {!s.current && (
              <button
                type="button"
                onClick={() => revoke(s)}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger-bg)]"
              >
                {t('hq.security.revoke')}
              </button>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
