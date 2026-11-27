import type { B2bProspectStatus } from './b2b-prospect';

/**
 * Who may move a prospect where. DO_NOT_CONTACT is entered only through its own routes and
 * CONVERTED only through convert, so neither appears as a target here; both are terminal.
 * LOST -> NEW is the reopen (Manage only, checked by the service).
 */
const TRANSITIONS: Readonly<Record<B2bProspectStatus, readonly B2bProspectStatus[]>> = {
  NEW: ['CONTACTED', 'VISITED', 'LOST'],
  CONTACTED: ['VISITED', 'INTERESTED', 'LOST'],
  VISITED: ['CONTACTED', 'INTERESTED', 'LOST'],
  INTERESTED: ['VISITED', 'LOST'],
  LOST: ['NEW'],
  CONVERTED: [],
  DO_NOT_CONTACT: [],
};

export function canTransition(from: B2bProspectStatus, to: B2bProspectStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A status a person may set with PATCH /:id/status (VISITED from NEW comes from a GPS check-in only). */
export function canSetByHand(from: B2bProspectStatus, to: B2bProspectStatus): boolean {
  return canTransition(from, to) && !(from === 'NEW' && to === 'VISITED');
}

export function isTerminal(status: B2bProspectStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
