export interface VisitNotice {
  kind: 'FINDING' | 'OVERDUE';
  depotId: string;
  depotName: string;
  /** Required for FINDING. */
  visitId?: string;
  /** The WIB day of the notice (crm's dedupe key for an overdue notice). */
  dateKey: string;
  /** One line per finding, 30 at most. */
  items: string[];
}

/**
 * Tells crm-service about a visit's findings or a depot's overdue follow-ups. Best effort: it
 * never throws, so a visit is never failed by its notice. `true` = crm accepted it (2xx); `false`
 * = it did not (the sweep then does not stamp the follow-ups and tries again tomorrow).
 */
export interface VisitNotifierPort {
  notify(notice: VisitNotice): Promise<boolean>;
}
