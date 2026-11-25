/** One depot's open items, counted now. */
export interface OpenQueueRow {
  depotId: string;
  /** Incidents not yet RESOLVED (OPEN or IN_PROGRESS). */
  incidents: number;
  /** Order disputes still OPEN. */
  disputes: number;
  /** Approvals still PENDING (count differences, deposit refunds, COD and gallon variances). */
  approvals: number;
  /** Maintenance items whose next service date has passed (by days only: items due by water volume are not counted here). */
  maintenanceOverdue: number;
}

/** HD-6 H4 part 2: the open-queue facts of A-01. */
export interface AiQueuesRepository {
  /** One count per depot per queue; a depot with nothing open is simply absent from that queue's counts. */
  openCounts(depotIds: readonly string[], now: Date): Promise<{
    incidents: Map<string, number>;
    disputes: Map<string, number>;
    approvals: Map<string, number>;
    maintenanceOverdue: Map<string, number>;
  }>;
}

export const AI_QUEUES_REPOSITORY = Symbol('AiQueuesRepository');
