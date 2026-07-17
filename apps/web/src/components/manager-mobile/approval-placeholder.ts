// Depot-manager approval inbox (design cells 1c/1d).
//
// TODO: wire to approval-queue endpoint when backend lands. No approval-queue backend
// exists yet (no endpoints.ts group, no service). Until it does, these hand-authored
// rows drive the inbox + detail so the screens are reviewable against the design.

export type ApprovalKind = 'OPNAME_VARIANCE' | 'REFUND_DEPOSIT' | 'SETTLEMENT_SHORTFALL';

export interface ManagerApproval {
  id: string;
  kind: ApprovalKind;
  title: string;
  subtitle: string;
  /** Rupiah at stake (loss/refund/shortfall). */
  amount: number;
  requestedBy: string;
  requestedAt: string;
  /** System-recorded count (opname) / expected figure. */
  systemvalue: number;
  /** Physically counted / actual figure. */
  physicalValue: number;
  /** Below this loss the request auto-passes without manager review. */
  autoPassThreshold: number;
  note: string;
  photos: number;
}

export const KIND_LABEL: Record<ApprovalKind, string> = {
  OPNAME_VARIANCE: 'Selisih opname',
  REFUND_DEPOSIT: 'Refund deposit galon',
  SETTLEMENT_SHORTFALL: 'Kurang setoran (COD)',
};

export const APPROVALS: ManagerApproval[] = [
  {
    id: 'a1',
    kind: 'OPNAME_VARIANCE',
    title: 'Selisih stok galon 19L',
    subtitle: 'Opname sore · Gudang A',
    amount: 240_000,
    requestedBy: 'Rizky (operator)',
    requestedAt: '2026-07-18T09:12:00+07:00',
    systemvalue: 132,
    physicalValue: 120,
    autoPassThreshold: 100_000,
    note: '12 galon tidak ditemukan saat opname sore. Sudah dicek ulang di rak & area cuci.',
    photos: 2,
  },
  {
    id: 'a2',
    kind: 'REFUND_DEPOSIT',
    title: 'Refund deposit 6 galon',
    subtitle: 'Pelanggan berhenti langganan',
    amount: 300_000,
    requestedBy: 'Sari (kasir)',
    requestedAt: '2026-07-18T08:40:00+07:00',
    systemvalue: 6,
    physicalValue: 6,
    autoPassThreshold: 250_000,
    note: 'Pelanggan mengembalikan 6 galon kondisi baik. Deposit Rp50.000/galon.',
    photos: 1,
  },
  {
    id: 'a3',
    kind: 'SETTLEMENT_SHORTFALL',
    title: 'Kurang setoran kurir',
    subtitle: 'Budi · shift pagi',
    amount: 85_000,
    requestedBy: 'Budi (kurir)',
    requestedAt: '2026-07-18T07:55:00+07:00',
    systemvalue: 1_450_000,
    physicalValue: 1_365_000,
    autoPassThreshold: 50_000,
    note: 'Setoran tunai kurang Rp85.000 dari total COD yang tercatat sistem.',
    photos: 0,
  },
];
