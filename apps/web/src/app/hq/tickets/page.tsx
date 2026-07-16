'use client';

import { useState } from 'react';
import { ChatCircleDots } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, Chip } from '@/components/ui';
import { useToast } from '@/components/toast';
import { TICKETS_STUB, agoLabel, type TicketRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 15a — support tickets. No support/ticket service, so threads are stubbed; assign
// and resolve mutate local state + toast.
const PRIORITY_TONE: Record<TicketRow['priority'], 'danger' | 'warning' | 'neutral'> = {
  tinggi: 'danger',
  sedang: 'warning',
  rendah: 'neutral',
};

export default function HqTicketsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<TicketRow[]>(TICKETS_STUB);

  function assign(id: string) {
    setTickets((prev) => prev.map((x) => (x.id === id ? { ...x, assignee: 'Kamu' } : x)));
    toast(t('hq.tickets.assigned'), 'success');
  }
  function resolve(row: TicketRow) {
    setTickets((prev) => prev.map((x) => (x.id === row.id ? { ...x, status: 'selesai' } : x)));
    toast(t('hq.tickets.resolved', { subject: row.subject }), 'success');
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={ChatCircleDots} title={t('hq.tickets.title')} subtitle={t('hq.tickets.subtitle')} stub />

      <div className="flex flex-col gap-3">
        {tickets.map((tk) => (
          <Card key={tk.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{tk.subject}</span>
                <Badge tone={PRIORITY_TONE[tk.priority]}>{t(`hq.tickets.priority.${tk.priority}`)}</Badge>
                <Badge tone={tk.status === 'selesai' ? 'success' : 'warning'}>
                  {tk.status === 'selesai' ? t('hq.tickets.done') : t('hq.tickets.open')}
                </Badge>
              </div>
              <Chip tone="outline">
                {t('hq.tickets.order')} {tk.orderNumber}
              </Chip>
            </div>
            <p className="text-xs text-muted">
              {tk.customer} · {tk.assignee ?? t('hq.tickets.unassigned')}
            </p>

            <div className="flex flex-col gap-2 rounded-xl bg-[color:var(--surface-soft)] p-3">
              {tk.thread.map((m, i) => (
                <div key={i} className={m.from === 'agent' ? 'text-right' : ''}>
                  <span
                    className={
                      'inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ' +
                      (m.from === 'agent' ? 'bg-brand-600 text-on-brand' : 'surface border border-app')
                    }
                  >
                    {m.text}
                  </span>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    {m.from === 'agent' ? t('hq.tickets.agent') : t('hq.tickets.customer')} · {agoLabel(m.agoMin, t)}
                  </p>
                </div>
              ))}
            </div>

            {tk.status !== 'selesai' && (
              <div className="flex justify-end gap-2">
                {!tk.assignee && (
                  <Button variant="secondary" onClick={() => assign(tk.id)}>
                    {t('hq.tickets.assign')}
                  </Button>
                )}
                <Button onClick={() => resolve(tk)}>{t('hq.tickets.resolve')}</Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
