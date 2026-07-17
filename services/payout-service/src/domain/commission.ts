// Commission-scheme domain types (design 21c). The domain never imports the
// generated Prisma client.

export interface CommissionSchemeRecord {
  id: string;
  depotId: string;
  ownerName: string | null;
  /** Franchise payout percentage (0..100). */
  pct: number;
  effectiveDate: Date;
  createdAt: Date;
}
