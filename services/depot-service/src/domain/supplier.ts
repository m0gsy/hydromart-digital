// Depot supplier directory (design 11b). A depot-scoped vendor that supplies raw stock
// (galon, segel, air baku). Mirrors the Prisma model; the domain never imports the client.

/** A depot-scoped supplier of raw stock (galon/segel/air baku). */
export interface Supplier {
  id: string;
  depotId: string;
  name: string;
  /** Short human code, unique within a depot. */
  code: string;
  contactPhone: string | null;
  /** What they supply, e.g. ['Galon 19L', 'Segel', 'Air baku']. */
  categories: string[];
  /** On-time delivery rate 0..1; null until enough POs have landed. */
  onTimeRate: number | null;
  createdAt: Date;
}
