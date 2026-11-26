/** One permit or lab test that is due or overdue (depot-service `GET internal/compliance/due`). */
export interface DueCompliance {
  id: string;
  depotId: string;
  depotName: string;
  kind: 'PERMIT' | 'LAB_TEST';
  name: string;
  /** The day it falls (fell) due. */
  dueOn: string;
  /** Days left until dueOn; zero or negative = due today or overdue. */
  daysLeft: number;
  /** WIB day key the due cycle started on. */
  cycleStart: string;
}

/** HD-14. THROWS when it cannot find out: "nothing is due" must never be what an outage says. */
export interface ComplianceDuePort {
  dueItems(): Promise<DueCompliance[]>;
}
