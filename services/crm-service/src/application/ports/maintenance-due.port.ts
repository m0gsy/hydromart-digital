/** One item that is due for service (depot-service `GET internal/maintenance/due`). */
export interface DueMaintenance {
  id: string;
  depotId: string;
  depotName: string;
  name: string;
  category: string;
  dueBy: 'DAYS' | 'VOLUME';
  daysSinceService: number;
  m3SinceService: number | null;
  intervalDays: number | null;
  intervalM3: number | null;
  /** WIB day key the due cycle started on (the last service, else the day the item was added). */
  cycleStart: string;
}

/** HD-15. THROWS when it cannot find out: "nothing is due" must never be what an outage says. */
export interface MaintenanceDuePort {
  dueItems(): Promise<DueMaintenance[]>;
}
