'use client';

import { useState } from 'react';
import { ChatCircleText, Lock } from '@phosphor-icons/react';

import { CampaignList } from '@/components/campaigns/campaign-list';
import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { parseRecipients } from '@/lib/campaigns';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canManageCampaigns, canViewCampaigns } from '@/lib/roles';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

type Audience = 'list' | 'segment';

/** Create-a-campaign form. Reloads the list on success. */
function CreateForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<Audience>('list');
  const [recipients, setRecipients] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setMessage('');
    setRecipients('');
    setCity('');
    setAudience('list');
    setError(null);
  }

  async function submit() {
    if (!name.trim() || !message.trim()) {
      setError(t('dashboard.campaigns.nameMsgRequired'));
      return;
    }
    const body: Record<string, unknown> = { name: name.trim(), messageTemplate: message };
    if (audience === 'list') {
      const parsed = parseRecipients(recipients);
      if (parsed.length === 0) {
        setError(t('dashboard.campaigns.addRecipient'));
        return;
      }
      body.recipients = parsed;
    } else {
      if (!city.trim()) {
        setError(t('dashboard.campaigns.pickSegment'));
        return;
      }
      body.segment = { city: city.trim() };
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.crm.createCampaign, body, true);
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashboard.campaigns.createError'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <ChatCircleText size={18} weight="fill" />
        {t('dashboard.campaigns.newCampaign')}
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">{t('dashboard.campaigns.newBroadcast')}</h2>
      <Field label={t('dashboard.campaigns.nameLabel')} htmlFor="c-name">
        <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dashboard.campaigns.namePlaceholder')} />
      </Field>
      <Field
        label={t('dashboard.campaigns.messageLabel')}
        htmlFor="c-msg"
        hint={t('dashboard.campaigns.messageHint')}
      >
        <textarea
          id="c-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder={t('dashboard.campaigns.messagePlaceholder')}
        />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('dashboard.campaigns.audience')}</span>
        <div className="flex gap-2">
          <Button variant={audience === 'list' ? 'primary' : 'secondary'} onClick={() => setAudience('list')}>
            {t('dashboard.campaigns.phoneList')}
          </Button>
          <Button variant={audience === 'segment' ? 'primary' : 'secondary'} onClick={() => setAudience('segment')}>
            {t('dashboard.campaigns.segment')}
          </Button>
        </div>
      </div>

      {audience === 'list' ? (
        <Field label={t('dashboard.campaigns.recipientsLabel')} htmlFor="c-rcp" hint={t('dashboard.campaigns.recipientsHint')}>
          <textarea
            id="c-rcp"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            rows={4}
            className={inputClass}
            placeholder={'+6281234567890,Andi\n081111111111'}
          />
        </Field>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Field label={t('dashboard.campaigns.city')} htmlFor="c-city">
            <Input id="c-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('dashboard.campaigns.cityPlaceholder')} />
          </Field>
        </div>
      )}

      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          {t('dashboard.campaigns.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('dashboard.campaigns.createDraft')}
        </Button>
      </div>
    </Card>
  );
}

function CampaignsBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const canManage = canManageCampaigns(customer?.role);
  // A new draft bumps this, and the list reads itself again.
  const [version, setVersion] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChatCircleText size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('dashboard.campaigns.title')}</h1>
        </div>
        {canManage && <CreateForm onCreated={() => setVersion((v) => v + 1)} />}
      </div>
      <CampaignList
        refresh={version}
        canManage={canManage}
        emptyHint={
          canManage ? t('dashboard.campaigns.noCampaignsManage') : t('dashboard.campaigns.noCampaignsView')
        }
      />
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewCampaigns(customer?.role)) {
    return (
      <CenterState title={t('dashboard.campaigns.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashboard.campaigns.gateBody')}
      </CenterState>
    );
  }
  return <CampaignsBody />;
}

export default function CampaignsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
