'use client';

import { useState } from 'react';
import { ChatCircleDots, PaperPlaneRight } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, Chip, ErrorState, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { agoLabel } from '@/lib/hq/stubs';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { getSession } from '@/lib/session-store';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { SupportTicket, TicketPriority, TicketStatus } from '@/lib/types';

// Design 15a — support tickets. Real admin-service track: HEAD_OFFICE + SUPER_ADMIN. List
// with message threads; reply / assign / resolve mutate a ticket. `assigneeId` is the raw
// account id (no staff-directory join yet).
type Filter = 'all' | TicketStatus;

const PRIORITY_TONE: Record<TicketPriority, 'danger' | 'warning' | 'neutral'> = {
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'neutral',
};
const STATUS_TONE: Record<TicketStatus, 'success' | 'warning' | 'brand'> = {
  RESOLVED: 'success',
  ASSIGNED: 'brand',
  OPEN: 'warning',
};

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export default function HqTicketsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const query = useAsync<SupportTicket[]>(
    () => api.get(endpoints.admin.tickets.list({ status: filter === 'all' ? undefined : filter }), true),
    [filter],
  );

  const chips: Filter[] = ['all', 'OPEN', 'ASSIGNED', 'RESOLVED'];
  const label = (f: Filter) => (f === 'all' ? t('hq.tickets.all') : t(`hq.tickets.status.${f}`));

  async function assign(tk: SupportTicket) {
    try {
      const me = getSession()?.customer;
      await api.post(endpoints.admin.tickets.assign(tk.id), { assigneeId: me?.id ?? 'me' }, true);
      toast(t('hq.tickets.assigned'), 'success');
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.tickets.saveError'), 'error');
    }
  }
  async function resolve(tk: SupportTicket) {
    try {
      await api.post(endpoints.admin.tickets.resolve(tk.id), {}, true);
      toast(t('hq.tickets.resolved', { subject: tk.subject }), 'success');
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.tickets.saveError'), 'error');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={ChatCircleDots} title={t('hq.tickets.title')} subtitle={t('hq.tickets.subtitle')} />

      <div className="flex flex-wrap gap-2">
        {chips.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
              filter === f ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app text-muted hover:bg-[color:var(--surface-soft)]'
            }`}
          >
            {label(f)}
          </button>
        ))}
      </div>

      {query.loading ? (
        <Skeleton className="h-96 w-full" />
      ) : query.error ? (
        <ErrorState message={t('hq.tickets.loadError')} onRetry={query.reload} />
      ) : (query.data ?? []).length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.tickets.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {(query.data ?? []).map((tk) => (
            <Card key={tk.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{tk.subject}</span>
                  <Badge tone={PRIORITY_TONE[tk.priority]}>{t(`hq.tickets.priority.${tk.priority}`)}</Badge>
                  <Badge tone={STATUS_TONE[tk.status]}>{t(`hq.tickets.status.${tk.status}`)}</Badge>
                </div>
                {tk.orderRef && (
                  <Chip tone="outline">
                    {t('hq.tickets.order')} {tk.orderRef}
                  </Chip>
                )}
              </div>
              <p className="text-xs text-muted">
                {tk.customerRef} · {tk.customerPhone} ·{' '}
                {tk.assigneeId ? t('hq.tickets.assignedTo', { who: tk.assigneeId }) : t('hq.tickets.unassigned')}
              </p>

              <div className="flex flex-col gap-2 rounded-xl bg-[color:var(--surface-soft)] p-3">
                {tk.messages.map((m) => (
                  <div key={m.id} className={m.authorType === 'STAFF' ? 'text-right' : ''}>
                    <span
                      className={
                        'inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ' +
                        (m.authorType === 'STAFF' ? 'bg-brand-600 text-on-brand' : 'surface border border-app')
                      }
                    >
                      {m.body}
                    </span>
                    <p className="mt-0.5 text-[10.5px] text-muted">
                      {m.authorType === 'STAFF' ? t('hq.tickets.agent') : t('hq.tickets.customer')} ·{' '}
                      {agoLabel(minutesAgo(m.createdAt), t)}
                    </p>
                  </div>
                ))}
              </div>

              {tk.status !== 'RESOLVED' && <ReplyBox ticketId={tk.id} onSent={query.reload} />}

              {tk.status !== 'RESOLVED' && (
                <div className="flex justify-end gap-2">
                  {!tk.assigneeId && (
                    <Button variant="secondary" onClick={() => assign(tk)}>
                      {t('hq.tickets.assign')}
                    </Button>
                  )}
                  <Button onClick={() => resolve(tk)}>{t('hq.tickets.resolve')}</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplyBox({ ticketId, onSent }: { ticketId: string; onSent: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      await api.post(endpoints.admin.tickets.reply(ticketId), { body: text }, true);
      setBody('');
      toast(t('hq.tickets.replied'), 'success');
      onSent();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.tickets.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('hq.tickets.replyPlaceholder')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send();
        }}
      />
      <Button onClick={send} disabled={!body.trim()} loading={busy}>
        <PaperPlaneRight size={16} /> {t('hq.tickets.send')}
      </Button>
    </div>
  );
}
