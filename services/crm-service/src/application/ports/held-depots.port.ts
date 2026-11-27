/**
 * HD-14: which depots are on a quality hold right now (depot-service, read fresh on every call).
 * THROWS when it cannot find out: "nothing is held" must never be what an outage says.
 */
export interface HeldDepotsPort {
  heldDepotIds(): Promise<ReadonlySet<string>>;
  /** Every active depot by id: its name and whether it is on hold now. THROWS like heldDepotIds. */
  depotsById(): Promise<ReadonlyMap<string, { name: string; held: boolean; since: string | null }>>;
}
