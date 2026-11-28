'use client';

import { useEffect, useState } from 'react';
import { WhatsappLogo } from '@phosphor-icons/react';

import { Button, Card, Chip } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT, useWaStrings } from '@/lib/locale-context';
import { openExternal } from '@/lib/platform';
import type { WaCode, WaMe } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

/**
 * HD-12/HD-13: the customer connects WhatsApp number 1. The button makes a 30-minute code and opens a chat
 * with `DAFTAR <code>` prefilled; the customer presses send, so the customer always starts the chat.
 *
 * Hidden unless `/whatsapp/status` says the channel is on, and also when that call fails: while WhatsApp is
 * off (or the app is older than the server) the account screen shows nothing at all. Nothing here sends.
 */
export function WaOptInCard() {
  const status = useAsync<{ enabled: boolean }>(() => api.get(endpoints.whatsapp.status, true));
  return status.data?.enabled === true ? <WaOptInBody /> : null;
}

function WaOptInBody() {
  const { t } = useT();
  const strings = useWaStrings();
  const { toast } = useToast();
  const me = useAsync<WaMe>(() => api.get(endpoints.whatsapp.me, true));
  const [busy, setBusy] = useState(false);
  const { reload } = me;

  // The customer comes back from WhatsApp after pressing send: ask again so the card shows the link.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  async function connect() {
    setBusy(true);
    try {
      const code = await api.post<WaCode>(endpoints.whatsapp.selfCode, {}, true);
      if (!openExternal(code.link)) window.open(code.link, '_blank', 'noopener,noreferrer');
    } catch {
      toast(t('wa.card.error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.post(endpoints.whatsapp.revoke, {}, true);
      toast(t('wa.card.disconnectedToast'), 'success');
      reload();
    } catch {
      toast(t('wa.card.disconnectError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const state = me.data?.state ?? null;
  // The state is unknown while it loads or when it cannot be read: show nothing rather than a wrong button.
  if (!state || !strings) return null;

  return (
    <Card className="flex flex-col gap-2 p-4" testId="wa-opt-in-card">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <WhatsappLogo size={18} weight="fill" className="text-[#25D366]" />
        {t('wa.card.title')}
      </h2>
      {state === 'GRANTED' ? (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Chip tone="tint">{t('wa.card.connected', { phone: me.data?.phone ?? '' })}</Chip>
          </p>
          <Button variant="secondary" loading={busy} onClick={() => void disconnect()}>
            {t('wa.card.disconnect')}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">{t('wa.card.offTitle')}</p>
          <p className="text-xs text-muted">{t('wa.card.helper')}</p>
          {state === 'STOPPED' && <p className="text-xs text-muted">{t('wa.card.stopped')}</p>}
          <Button loading={busy} onClick={() => void connect()}>
            {t('wa.card.connect')}
          </Button>
        </>
      )}
    </Card>
  );
}
