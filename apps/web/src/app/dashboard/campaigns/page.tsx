'use client';

import { useState } from 'react';
import { ChatCircleText, Lock, PaperPlaneTilt } from '@phosphor-icons/react';

import { CampaignReport } from '@/components/dashboard/campaign-report';
import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { parseRecipients } from '@/lib/campaigns';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { canManageCampaigns, canViewCampaigns } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Campaign, CampaignStatus, Page } from '@/lib/types';

const STATUS_TONE: Record<CampaignStatus, 'neutral' | 'brand' | 'success'> = {
  DRAFT: 'neutral',
  SENDING: 'brand',
  SENT: 'success',
};

// Segment tiers accepted by customer-service (MembershipTier). Blank = no filter.
const TIERS = ['REGULAR', 'SILVER', 'GOLD', 'PLATINUM'];

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

type Audience = 'list' | 'segment';

/** Create-a-campaign form. Reloads the list on success. */
function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<Audience>('list');
  const [recipients, setRecipients] = useState('');
  const [tier, setTier] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setMessage('');
    setRecipients('');
    setTier('');
    setCity('');
    setAudience('list');
    setError(null);
  }

  async function submit() {
    if (!name.trim() || !message.trim()) {
      setError('Name and message are required.');
      return;
    }
    const body: Record<string, unknown> = { name: name.trim(), messageTemplate: message };
    if (audience === 'list') {
      const parsed = parseRecipients(recipients);
      if (parsed.length === 0) {
        setError('Add at least one recipient (one phone per line).');
        return;
      }
      body.recipients = parsed;
    } else {
      if (!tier && !city.trim()) {
        setError('Pick a tier or enter a city to target a segment.');
        return;
      }
      body.segment = { tier: tier || undefined, city: city.trim() || undefined };
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.crm.createCampaign, body, true);
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the campaign.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <ChatCircleText size={18} weight="fill" />
        New campaign
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">New broadcast campaign</h2>
      <Field label="Name" htmlFor="c-name">
        <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ramadan Promo Blast" />
      </Field>
      <Field
        label="Message"
        htmlFor="c-msg"
        hint="Supports {{name}} and {{phone}} tokens."
      >
        <textarea
          id="c-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder="Hi {{name}}, enjoy 20% off your next refill!"
        />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Audience</span>
        <div className="flex gap-2">
          <Button variant={audience === 'list' ? 'primary' : 'secondary'} onClick={() => setAudience('list')}>
            Phone list
          </Button>
          <Button variant={audience === 'segment' ? 'primary' : 'secondary'} onClick={() => setAudience('segment')}>
            Segment
          </Button>
        </div>
      </div>

      {audience === 'list' ? (
        <Field label="Recipients" htmlFor="c-rcp" hint="One per line: phone or phone,name">
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
          <Field label="Tier" htmlFor="c-tier">
            <select id="c-tier" value={tier} onChange={(e) => setTier(e.target.value)} className={`${inputClass} min-w-40`}>
              <option value="">Any tier</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="City" htmlFor="c-city">
            <Input id="c-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bandung" />
          </Field>
        </div>
      )}

      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} loading={busy}>
          Create draft
        </Button>
      </div>
    </Card>
  );
}

function CampaignCard({
  campaign,
  canManage,
  onReport,
  onChanged,
}: {
  campaign: Campaign;
  canManage: boolean;
  onReport: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!window.confirm(`Send "${campaign.name}" to ${campaign.totalRecipients} recipient(s)? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.crm.sendCampaign(campaign.id), undefined, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the campaign.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{campaign.name}</p>
          <p className="text-xs text-muted">
            {campaign.channel} · {new Date(campaign.createdAt).toLocaleDateString('id-ID')}
          </p>
        </div>
        <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <dt className="text-xs text-muted">Recipients</dt>
          <dd className="font-semibold tabular-nums">{campaign.totalRecipients}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Sent</dt>
          <dd className="font-semibold tabular-nums text-green-700">{campaign.sentCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Failed</dt>
          <dd className={`font-semibold tabular-nums ${campaign.failedCount > 0 ? 'text-red-600' : ''}`}>
            {campaign.failedCount}
          </dd>
        </div>
      </dl>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-app pt-2">
        <Button variant="ghost" onClick={onReport} disabled={busy}>
          Lihat laporan
        </Button>
        {canManage && campaign.status === 'DRAFT' && (
          <Button onClick={send} loading={busy}>
            <PaperPlaneTilt size={16} weight="fill" />
            Send now
          </Button>
        )}
      </div>
    </Card>
  );
}

function CampaignsBody() {
  const { customer } = useAuth();
  const canManage = canManageCampaigns(customer?.role);
  const [reportId, setReportId] = useState<string | null>(null);
  const list = useAsync<Page<Campaign>>(() => api.get(endpoints.crm.campaigns({ limit: 50 }), true));
  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChatCircleText size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Campaigns</h1>
        </div>
        {canManage && <CreateForm onCreated={list.reload} />}
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <CenterState title="No campaigns yet" icon={<ChatCircleText size={40} weight="fill" />}>
          {canManage ? 'Create a draft to broadcast to your customers.' : 'No broadcast campaigns have been created.'}
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              canManage={canManage}
              onReport={() => setReportId(c.id)}
              onChanged={list.reload}
            />
          ))}
        </div>
      )}

      {reportId && <CampaignReport campaignId={reportId} onClose={() => setReportId(null)} />}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canViewCampaigns(customer?.role)) {
    return (
      <CenterState title="Staff access only" icon={<Lock size={40} weight="fill" />}>
        Broadcast campaigns are available to marketing and head-office staff.
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
