'use client';

import { useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, Toggle } from '@/components/ui';
import { useToast } from '@/components/toast';
import { ACTIVE_SESSIONS_STUB, agoLabel, type SessionRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 19b — security & 2FA. No session-admin endpoint, so 2FA toggle, IP allowlist and
// sessions are local state; save / revoke just toast.
export default function HqSecurityPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [twoFa, setTwoFa] = useState(true);
  const [allowlist, setAllowlist] = useState('103.21.0.0/16\n180.2.0.0/16');
  const [sessions, setSessions] = useState<SessionRow[]>(ACTIVE_SESSIONS_STUB);

  function revoke(s: SessionRow) {
    setSessions((prev) => prev.filter((x) => x.id !== s.id));
    toast(t('hq.security.revoked'), 'info');
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Lock} title={t('hq.security.title')} subtitle={t('hq.security.subtitle')} stub />

      <Card className="flex flex-col gap-4 p-5">
        <p className="text-sm font-extrabold">{t('hq.security.sessionPolicy')}</p>
        <div className="flex items-center justify-between border-b border-[color:var(--border-soft)] pb-3">
          <span className="text-sm text-muted">{t('hq.security.sessionTimeout')}</span>
          <span className="text-sm font-semibold">{t('hq.security.sessionTimeoutValue')}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('hq.security.twoFa')}</p>
            <p className="text-xs text-muted">{t('hq.security.twoFaBody')}</p>
          </div>
          <Toggle on={twoFa} onChange={setTwoFa} label={t('hq.security.twoFa')} />
        </div>
        <div>
          <label htmlFor="ips" className="text-sm font-semibold">
            {t('hq.security.ipAllowlist')}
          </label>
          <textarea
            id="ips"
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            rows={3}
            className="surface-elevated mt-1.5 w-full rounded-lg border border-app px-3.5 py-2.5 font-mono text-xs focus:outline focus:outline-2 focus:outline-brand-600"
          />
          <p className="mt-1 text-xs text-muted">{t('hq.security.ipHint')}</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => toast(t('hq.security.saved'), 'success')}>{t('hq.security.save')}</Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <p className="mb-1 text-sm font-extrabold">{t('hq.security.sessionsTitle')}</p>
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
