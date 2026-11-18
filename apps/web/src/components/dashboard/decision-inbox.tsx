'use client';

import Link from 'next/link';
import { CaretRight } from '@phosphor-icons/react';

import { Badge, Card } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { queuesFor, type DecisionQueue } from '@/lib/decision-queues';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';

/**
 * Flow PR-4: "Menunggu keputusan Anda" — every other queue this role decides, in one card on
 * the approvals screens, each a door to the screen where it is decided. Nothing for a role
 * that decides nothing else.
 */
export function DecisionInbox() {
  const { t } = useT();
  const { customer } = useAuth();
  const role = customer?.role;
  const queues = queuesFor(role);
  if (queues.length === 0) return null;
  return (
    <Card className="p-4">
      <p className="text-sm font-bold">{t('opsFix.inbox.title')}</p>
      <ul className="mt-1 divide-y divide-app">
        {queues.map((q) => (
          <QueueRow key={q.key} q={q} role={role} />
        ))}
      </ul>
    </Card>
  );
}

function QueueRow({ q, role }: { q: DecisionQueue; role: string | null | undefined }) {
  const { t } = useT();
  // A count that cannot be read is no count: the row falls back to "Buka", never to 0.
  const count = useAsync<number | null>(
    () => (q.count ? q.count(role).catch(() => null) : Promise.resolve(null)),
    [q.key, role],
  );
  return (
    <li>
      <Link href={q.href} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
        <span className="font-semibold">{t(q.label)}</span>
        <span className="flex items-center gap-1.5">
          {typeof count.data === 'number' ? (
            <Badge tone={count.data > 0 ? 'warning' : 'neutral'}>{count.data}</Badge>
          ) : (
            <span className="font-semibold text-brand-700">{t('opsFix.inbox.open')}</span>
          )}
          <CaretRight size={14} className="text-[color:var(--text-muted)]" />
        </span>
      </Link>
    </li>
  );
}
