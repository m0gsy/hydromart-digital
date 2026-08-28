'use client';

import { DetailRow, DetailSheet } from '@/components/detail-sheet';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { SupportTicket } from '@/lib/types';

/**
 * One support ticket, re-read by id, with its whole message thread.
 *
 * `GET /admin/api/v1/tickets/:id` was left unwired because "the ticket list carries the
 * whole ticket". True when the queue loads, and false the moment anybody replies: the list
 * is a snapshot, and a reply written after it lands on the server and not on the screen.
 * Reading the one ticket is what makes the thread current.
 */
export function TicketDetail({ ticketId }: { ticketId: string }) {
  const { t } = useT();
  return (
    <DetailSheet<SupportTicket>
      load={() => api.get<SupportTicket>(endpoints.admin.tickets.get(ticketId), true)}
      deps={[ticketId]}
      errorMessage={t('hq.tickets.detailError')}
    >
      {(ticket) => (
        <div className="flex flex-col gap-3">
          <div className="divide-y divide-[color:var(--border-soft)]">
            <DetailRow label={t('hq.tickets.detailCustomer')}>
              {ticket.customerRef} · {ticket.customerPhone}
            </DetailRow>
            <DetailRow label={t('hq.tickets.detailOrder')}>{ticket.orderRef ?? '—'}</DetailRow>
            <DetailRow label={t('hq.tickets.detailOpened')}>
              {formatDateTime(ticket.createdAt)}
            </DetailRow>
          </div>

          <div>
            <h3 className="text-sm font-bold">{t('hq.tickets.detailThread')}</h3>
            {ticket.messages.length === 0 ? (
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                {t('hq.tickets.detailThreadEmpty')}
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {ticket.messages.map((m) => (
                  <li key={m.id} className="rounded-xl border border-app px-3 py-2 text-[13px]">
                    <div className="text-[11.5px] text-[color:var(--text-muted)]">
                      {t(`hq.tickets.author.${m.authorType}`)} · {formatDateTime(m.createdAt)}
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap">{m.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </DetailSheet>
  );
}
