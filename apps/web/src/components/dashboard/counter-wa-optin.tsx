'use client';

import { useEffect, useState } from 'react';
import { WhatsappLogo } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { qrPath } from '@/lib/wa-qr';
import type { WaCode } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

const POLL_MS = 3000;

type CodeState = 'WAITING' | 'USED' | 'EXPIRED';

/**
 * HD-12/HD-13, the counter: the customer standing at the till scans a QR, WhatsApp opens a chat to number 1
 * with `DAFTAR <code>` prefilled, and they press send. Walk-in only: the code links no account.
 *
 * Hidden while `/whatsapp/status` is off or unreadable. The QR library loads only when a code is shown.
 * The panel polls the code every 3 s until it is used or its 30 minutes are up. Nothing here sends a message.
 */
export function CounterWaOptIn({ depotId }: { depotId: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const { customer } = useAuth();
  // Only a role the server lets issue a code is asked at all (waOptInIssue); the rest see nothing.
  const allowed = can('waOptInIssue', customer?.role);
  const status = useAsync<{ enabled: boolean }>(
    () => (allowed ? api.get(endpoints.whatsapp.status, true) : Promise.resolve({ enabled: false })),
    [allowed],
  );
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<WaCode | null>(null);
  const [qr, setQr] = useState<{ size: number; d: string } | null>(null);
  const [state, setState] = useState<CodeState>('WAITING');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function issue() {
    setBusy(true);
    setFailed(false);
    try {
      const made = await api.post<WaCode>(endpoints.whatsapp.cashierCode, { depotId }, true);
      setQr(await qrPath(made.link));
      setState('WAITING');
      setCode(made);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // Poll until used or expired. A failed poll is not an answer: keep the code on screen and try again.
  useEffect(() => {
    if (!code || state !== 'WAITING') return;
    let alive = true;
    const timer = setInterval(() => {
      if (Date.parse(code.expiresAt) <= Date.now()) {
        setState('EXPIRED');
        return;
      }
      api
        .get<{ state: CodeState }>(endpoints.whatsapp.codeState(code.id), true)
        .then((r) => {
          if (alive) setState(r.state);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [code, state]);

  if (status.data?.enabled !== true) return null;

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.link);
      toast(t('wa.cashier.copied'), 'success');
    } catch {
      toast(t('wa.cashier.copyError'), 'error');
    }
  }

  if (!open) {
    return (
      <div className="sm:col-span-2">
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(true);
            void issue();
          }}
        >
          <WhatsappLogo size={16} weight="fill" className="text-[#25D366]" />
          {t('wa.cashier.open')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-app p-4 text-center sm:col-span-2" data-testid="counter-wa-optin">
      <p className="text-sm font-bold">{t('wa.cashier.title')}</p>
      <p className="text-xs text-muted">{t('wa.cashier.sub')}</p>
      {failed && <p className="text-xs text-[color:var(--danger)]">{t('wa.cashier.error')}</p>}
      {code && qr && (
        <>
          <svg
            role="img"
            aria-label={t('wa.cashier.qrAlt')}
            viewBox={`-4 -4 ${qr.size + 8} ${qr.size + 8}`}
            className={`h-48 w-48 rounded-lg bg-white ${state === 'WAITING' ? '' : 'opacity-30'}`}
            shapeRendering="crispEdges"
          >
            <path d={qr.d} fill="#000" />
          </svg>
          <p className="font-mono text-sm font-bold tracking-wider">{t('wa.cashier.codeLine', { code: code.code })}</p>
          {state === 'USED' && <p className="text-sm font-bold text-[color:var(--success)]">{t('wa.cashier.used')}</p>}
          {state === 'EXPIRED' && <p className="text-sm font-bold text-[color:var(--warning)]">{t('wa.cashier.expired')}</p>}
        </>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" loading={busy} onClick={() => void issue()}>
          {t('wa.cashier.renew')}
        </Button>
        <Button variant="ghost" disabled={!code} onClick={() => void copy()}>
          {t('wa.cashier.copy')}
        </Button>
      </div>
    </div>
  );
}
