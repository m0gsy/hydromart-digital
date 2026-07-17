'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  ClockCounterClockwise,
  Drop,
  Lock,
  Phone,
  ShoppingCart,
  Warning,
} from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, Chip, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, formatIDR } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canViewDepotCrm, isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotCustomerDetail } from '@/lib/types';

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]![0]! + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 text-center">
      <p className="text-xs text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{children}</p>
    </Card>
  );
}

const CHURN_TONE = { LOW: 'success', MEDIUM: 'warning', HIGH: 'danger' } as const;

function DetailBody({ id }: { id: string }) {
  const { scopedId } = useDepot();

  const detail = useAsync<DepotCustomerDetail>(
    () =>
      scopedId
        ? api.get(endpoints.depotCrm.detail(id, scopedId), true)
        : Promise.reject(new Error('Pilih depot dari switcher.')),
    [id, scopedId],
  );

  const { customer } = useAuth();
  const isManager = isDepotManager(customer?.role);

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/dashboard/customers"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
      >
        <ArrowLeft size={16} />
        Kembali ke pelanggan
      </Link>

      {detail.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : detail.error ? (
        <ErrorState message={detail.error} onRetry={detail.reload} />
      ) : !detail.data ? (
        <CenterState title="Tidak ditemukan">Pelanggan ini tidak ada.</CenterState>
      ) : (
        (() => {
          const { profile, addresses, depositLedger, recentOrders } = detail.data!;
          return (
            <>
              {/* Header */}
              <div className="flex items-center gap-3">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-800">
                  {initials(profile.fullName)}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-2xl font-bold">
                      {profile.fullName ?? 'Tanpa nama'}
                    </h1>
                    {profile.isSubscriber && <Chip tone="tint">Langganan</Chip>}
                  </div>
                  <p className="text-sm text-[color:var(--text-muted)]">{profile.phone ?? '—'}</p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Total pesanan">{profile.orderCount}</Stat>
                <Stat label="Nilai belanja">
                  <Money amount={profile.totalSpentIdr} />
                </Stat>
                <Stat label="Galon dipinjam">
                  <span className={profile.gallonsOnLoan >= 3 ? 'text-red-600' : ''}>
                    {profile.gallonsOnLoan}
                  </span>
                </Stat>
              </div>

              {/* Manager churn-risk panel (12b) — only when the forecast aggregate is present. */}
              {isManager && profile.churnRisk && (
                <Card className="flex items-center gap-3 p-4">
                  <Warning size={22} weight="fill" className="text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold">Risiko churn</p>
                    <p className="text-xs text-[color:var(--text-muted)]">
                      Pelanggan ini berisiko berhenti — pertimbangkan tawaran retensi.
                    </p>
                  </div>
                  <Badge tone={CHURN_TONE[profile.churnRisk]}>{profile.churnRisk}</Badge>
                </Card>
              )}

              {/* Deposit galon ledger */}
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <Drop size={18} weight="fill" className="text-brand-500" />
                  <h2 className="text-lg font-bold">Deposit galon</h2>
                </div>
                <Card className="p-4">
                  {depositLedger.length === 0 ? (
                    <p className="text-sm text-[color:var(--text-muted)]">Belum ada riwayat deposit galon.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {depositLedger.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                          <div>
                            <span className="font-medium">
                              {e.type === 'ISSUE' ? 'Pinjam' : 'Kembali'} {e.quantity} galon
                            </span>
                            <p className="text-xs text-[color:var(--text-muted)]">{formatDateTime(e.at)}</p>
                          </div>
                          <span
                            className={`font-semibold tabular-nums ${
                              e.type === 'ISSUE' ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {e.type === 'ISSUE' ? '+' : '−'}
                            {formatIDR(e.amountIdr)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </section>

              {/* Recent orders */}
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <ClockCounterClockwise size={18} weight="fill" className="text-brand-500" />
                  <h2 className="text-lg font-bold">Pesanan terakhir</h2>
                </div>
                <Card className="p-4">
                  {recentOrders.length === 0 ? (
                    <p className="text-sm text-[color:var(--text-muted)]">Belum ada pesanan.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {recentOrders.map((o) => (
                        <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
                          <div>
                            <span className="font-medium">{o.status}</span>
                            <p className="text-xs text-[color:var(--text-muted)]">{formatDateTime(o.placedAt)}</p>
                          </div>
                          <Money amount={o.totalIdr} className="font-semibold" />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </section>

              {addresses.length > 0 && (
                <section>
                  <h2 className="mb-2 text-lg font-bold">Alamat</h2>
                  <div className="flex flex-col gap-2">
                    {addresses.map((a) => (
                      <Card key={a.id} className="flex items-start justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {a.label}
                            {a.isPrimary && <Chip tone="outline" className="ml-2">Utama</Chip>}
                          </p>
                          <p className="text-sm text-[color:var(--text-muted)]">
                            {a.addressLine}, {a.city}
                          </p>
                        </div>
                        {a.inRadius != null && (
                          <Badge tone={a.inRadius ? 'success' : 'warning'}>
                            {a.inRadius ? 'Dalam jangkauan' : 'Luar jangkauan'}
                          </Badge>
                        )}
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Footer actions */}
              <div className="flex gap-3">
                {profile.phone ? (
                  <a href={`tel:${profile.phone}`} className="flex-1">
                    <Button variant="secondary" className="w-full">
                      <Phone size={16} className="mr-1" />
                      Hubungi
                    </Button>
                  </a>
                ) : (
                  <Button variant="secondary" className="flex-1" disabled>
                    <Phone size={16} className="mr-1" />
                    Hubungi
                  </Button>
                )}
                <Link href="/dashboard/orders" className="flex-1">
                  <Button className="w-full">
                    <ShoppingCart size={16} className="mr-1" />
                    Buatkan pesanan
                  </Button>
                </Link>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  const params = useParams<{ id: string }>();
  if (!canViewDepotCrm(customer?.role)) {
    return (
      <CenterState title="Akses staf saja" icon={<Lock size={40} weight="fill" />}>
        Direktori pelanggan tersedia untuk staf depot dan kantor pusat.
      </CenterState>
    );
  }
  return <DetailBody id={params.id} />;
}

export default function CustomerDetailPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
