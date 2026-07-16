'use client';

import { useState } from 'react';
import { Broadcast } from '@phosphor-icons/react';

import { Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { StubBadge, stubBroadcastReach } from '@/lib/hq/stubs';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { DepotAdmin, Page } from '@/lib/types';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

type Audience = 'all' | 'depot' | 'loyalty' | 'staff';
const AUDIENCES: Audience[] = ['all', 'depot', 'loyalty', 'staff'];
const CHANNELS = ['channelPush', 'channelInApp', 'channelWa'] as const;

// Design 10d — notification broadcast. The audience model (all/per-depot/loyalty/staff)
// doesn't map to crm.createCampaign's recipient/segment contract, so send is a stub toast;
// estimated reach has no sizing endpoint → stub. Depot list is real (for the picker).
export default function HqBroadcastPage() {
  const { t } = useT();
  const { toast } = useToast();
  const depots = useAsync<Page<DepotAdmin>>(() => api.get(endpoints.depots.manage({ limit: 100 }), true));

  const [audience, setAudience] = useState<Audience>('all');
  const [depotId, setDepotId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [channels, setChannels] = useState<Set<string>>(new Set(['channelPush', 'channelInApp']));

  const reach = stubBroadcastReach(audience);

  function submit(schedule: boolean) {
    if (!title.trim()) return toast(t('hq.broadcast.needTitle'), 'error');
    if (!message.trim()) return toast(t('hq.broadcast.needMessage'), 'error');
    toast(schedule ? t('hq.broadcast.scheduled') : t('hq.broadcast.sent'), 'success');
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Broadcast size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.broadcast.title')}</h1>
          <p className="text-sm text-muted">{t('hq.broadcast.subtitle')}</p>
        </div>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        {/* Audience */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('hq.broadcast.audience')}</span>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAudience(a)}
                aria-pressed={audience === a}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  audience === a ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app text-muted hover:bg-[color:var(--surface-soft)]'
                }`}
              >
                {t(`hq.broadcast.audiences.${a}`)}
              </button>
            ))}
          </div>
          {audience === 'depot' && (
            <select value={depotId} onChange={(e) => setDepotId(e.target.value)} className={`${inputClass} mt-1`}>
              <option value="">{t('hq.broadcast.pickDepot')}</option>
              {(depots.data?.items ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <Field label={t('hq.broadcast.titleLabel')} htmlFor="b-title">
          <Input id="b-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('hq.broadcast.titlePh')} />
        </Field>

        <Field label={t('hq.broadcast.messageLabel')} htmlFor="b-msg" hint={t('hq.broadcast.chars', { n: message.length })}>
          <textarea id="b-msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} className={inputClass} placeholder={t('hq.broadcast.messagePh')} />
        </Field>

        {/* Channels */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('hq.broadcast.channels')}</span>
          <div className="flex flex-wrap gap-3">
            {CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={channels.has(c)}
                  onChange={(e) =>
                    setChannels((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(c);
                      else next.delete(c);
                      return next;
                    })
                  }
                />
                {t(`hq.broadcast.${c}`)}
              </label>
            ))}
          </div>
        </div>
      </Card>

      {/* Estimated reach — STUB */}
      <Card className="flex items-center justify-between gap-3 p-5">
        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
          {t('hq.broadcast.reach')}
          <StubBadge />
        </span>
        <span className="text-2xl font-bold tabular-nums text-brand-700">
          {t('hq.broadcast.people', { n: reach.toLocaleString('id-ID') })}
        </span>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => submit(true)}>
          {t('hq.broadcast.schedule')}
        </Button>
        <Button onClick={() => submit(false)}>{t('hq.broadcast.send')}</Button>
      </div>
    </div>
  );
}
