'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CaretRight, Lock, MagnifyingGlass, UserPlus, Users } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, formatIDR } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canViewDepotCrm } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotCustomer } from '@/lib/types';

/** 3+ empties out at a customer is worth flagging in red (design 6a). */
const HIGH_LOAN = 3;

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]![0]! + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Avatar({ name }: { name: string | null }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
      {initials(name)}
    </span>
  );
}

function GallonCell({ gallons, deposit }: { gallons: number; deposit: number }) {
  if (gallons === 0) return <span className="text-[color:var(--text-muted)]">—</span>;
  return (
    <span className={gallons >= HIGH_LOAN ? 'font-semibold text-red-600' : ''}>
      {gallons} · {formatIDR(deposit)}
    </span>
  );
}

function CustomerRow({ c }: { c: DepotCustomer }) {
  return (
    <Link
      href={`/dashboard/customers/${c.id}`}
      className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] items-center gap-3 border-t border-app px-3 py-3 text-sm transition-colors hover:bg-brand-50"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={c.fullName} />
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {c.fullName ?? 'Tanpa nama'}
            {c.isSubscriber && (
              <Badge tone="brand">
                <span className="ml-1">Langganan</span>
              </Badge>
            )}
          </p>
          <p className="truncate text-xs text-[color:var(--text-muted)]">{c.phone ?? '—'}</p>
        </div>
      </div>
      <span className="tabular-nums">{c.orderCount}</span>
      <GallonCell gallons={c.gallonsOnLoan} deposit={c.depositHeldIdr} />
      <span className="text-[color:var(--text-muted)]">
        {c.lastOrderAt ? formatDateTime(c.lastOrderAt) : '—'}
      </span>
      <CaretRight size={16} className="justify-self-end text-[color:var(--text-muted)]" />
    </Link>
  );
}

function CustomersBody() {
  const { scopedId, selected, depots, ready } = useDepot();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  // Debounce the search box so we fetch once the operator pauses, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const rows = useAsync<DepotCustomer[]>(
    () =>
      scopedId
        ? api.get(endpoints.depotCrm.list(scopedId, q || undefined), true)
        : Promise.resolve([]),
    [scopedId, q],
  );

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Pelanggan</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau telepon"
              className="pl-9"
              aria-label="Cari pelanggan"
            />
          </div>
          {/* ponytail: walk-in registration is a separate flow (out of this milestone); rendered
              for header parity with design 6a. */}
          <Button variant="secondary" disabled title="Segera hadir">
            <UserPlus size={16} className="mr-1" />
            Walk-in
          </Button>
        </div>
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-[color:var(--text-muted)]">
          Pelanggan untuk{' '}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>{' '}
          (dari switcher).
        </p>
      )}

      {ready && depots.length === 0 ? (
        <CenterState title="Belum ada depot" icon={<Users size={40} weight="fill" />}>
          Belum ada depot yang dikonfigurasi.
        </CenterState>
      ) : rows.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.error ? (
        <ErrorState message={rows.error} onRetry={rows.reload} />
      ) : !rows.data || rows.data.length === 0 ? (
        <CenterState title="Tidak ada pelanggan" icon={<Users size={40} weight="fill" />}>
          {q ? 'Tidak ada yang cocok dengan pencarian.' : 'Depot ini belum punya pelanggan terdaftar.'}
        </CenterState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] gap-3 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              <span>Pelanggan</span>
              <span>Pesanan</span>
              <span>Galon dipinjam</span>
              <span>Terakhir</span>
              <span className="sr-only">Detail</span>
            </div>
            {rows.data.map((c) => (
              <CustomerRow key={c.id} c={c} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canViewDepotCrm(customer?.role)) {
    return (
      <CenterState title="Akses staf saja" icon={<Lock size={40} weight="fill" />}>
        Direktori pelanggan tersedia untuk staf depot dan kantor pusat.
      </CenterState>
    );
  }
  return <CustomersBody />;
}

export default function CustomersPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
