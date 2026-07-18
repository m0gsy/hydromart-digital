'use client';

import { Lock, ShieldCheck } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isStaff } from '@/lib/roles';
import { CAPABILITIES } from '@hydromart/access';

// Display roles (CUSTOMER holds no depot capability, so it is omitted). Order groups
// depot staff first, then oversight/office roles. DEPOT_MANAGER is the highlighted row.
const ROLES: { key: string; label: string }[] = [
  { key: 'DEPOT_OPERATOR', label: 'Operator' },
  { key: 'DEPOT_MANAGER', label: 'Manajer depot' },
  { key: 'DRIVER', label: 'Kurir' },
  { key: 'HEAD_OFFICE', label: 'Head office' },
  { key: 'FRANCHISE_OWNER', label: 'Pemilik waralaba' },
  { key: 'MARKETING', label: 'Marketing' },
  { key: 'FINANCE', label: 'Finance' },
  { key: 'SUPER_ADMIN', label: 'Super admin' },
];

// Indonesian label per capability key. Falls back to the raw key for any capability
// added to @hydromart/access before this map is updated.
const CAP_LABEL: Record<string, string> = {
  dashboard: 'Dashboard eksekutif',
  orderQueue: 'Antrean pesanan',
  inventoryRead: 'Inventory (lihat)',
  inventoryWrite: 'Inventory (ubah)',
  returnsRead: 'Retur galon (lihat)',
  returnsWrite: 'Retur galon (ubah)',
  campaignRead: 'Kampanye (lihat)',
  campaignWrite: 'Kampanye (kelola)',
  voucherRead: 'Voucher (lihat)',
  voucherWrite: 'Voucher (kelola)',
  depotAdmin: 'Harga dinamis / kelola depot',
  franchise: 'Laporan waralaba',
  payout: 'Payout waralaba',
  staffAdmin: 'Staf & peran',
  driverRoster: 'Roster kurir',
  opsNotif: 'Notifikasi operasional',
  tracking: 'Pelacakan & dispatch',
  forecast: 'Perencanaan / forecast',
  churn: 'Churn & re-engagement',
  paymentSettle: 'Konfirmasi pembayaran',
  courierPayout: 'Penghasilan kurir (milik sendiri)',
  courierSettle: 'Setoran COD kurir',
  expenseApprove: 'Setujui klaim biaya',
  depotBroadcast: 'Broadcast ke kurir',
  courierReturn: 'Ambil galon kosong (kurir)',
  depotCrm: 'Direktori pelanggan (CRM)',
  incidents: 'Insiden operasional',
  auditRead: 'Jejak audit',
  procurement: 'Pembelian & pemasok',
  approvals: 'Antrean persetujuan',
  depotFinance: 'Keuangan depot',
};

function MatrixBody() {
  const caps = Object.keys(CAPABILITIES);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Peran &amp; hak akses</h1>
          <p className="text-sm text-[color:var(--text-muted)]">Peran Manajer depot disorot</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {caps.map((cap) => {
          const holders = CAPABILITIES[cap as keyof typeof CAPABILITIES] as readonly string[];
          return (
            <Card key={cap} className="flex flex-col gap-2 p-4">
              <p className="text-sm font-semibold">{CAP_LABEL[cap] ?? cap}</p>
              <div className="flex flex-wrap gap-1.5">
                {ROLES.filter((r) => holders.includes(r.key)).map((r) =>
                  r.key === 'DEPOT_MANAGER' ? (
                    <Chip key={r.key} tone="tint" className="bg-brand-600 text-on-brand">
                      {r.label}
                    </Chip>
                  ) : (
                    <Chip key={r.key} tone="outline">
                      {r.label}
                    </Chip>
                  ),
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="flex flex-col gap-1 bg-brand-50 p-4">
        <p className="text-sm font-semibold text-brand-800">Read-only</p>
        <p className="text-[12.5px] text-brand-800">
          Matriks &amp; guard server membaca peta yang sama (CAPABILITIES) — tak bisa berbeda.
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isStaff(customer?.role)) {
    return (
      <CenterState title="Khusus staf" icon={<Lock size={40} weight="fill" />}>
        Matriks peran hanya untuk staf depot dan kantor pusat.
      </CenterState>
    );
  }
  return <MatrixBody />;
}

export default function RolesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
