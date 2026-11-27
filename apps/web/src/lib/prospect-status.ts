import type { ProspectStatus } from './types';

export const PROSPECT_STATUSES: readonly ProspectStatus[] = [
  'NEW',
  'CONTACTED',
  'VISITED',
  'INTERESTED',
  'CONVERTED',
  'LOST',
  'DO_NOT_CONTACT',
];

// A copy of the server's table (customer-service domain/b2b-prospect-status.ts). Terminal states
// have no way out; CONVERTED and DO_NOT_CONTACT are entered through their own routes.
const TRANSITIONS: Readonly<Record<ProspectStatus, readonly ProspectStatus[]>> = {
  NEW: ['CONTACTED', 'VISITED', 'LOST'],
  CONTACTED: ['VISITED', 'INTERESTED', 'LOST'],
  VISITED: ['CONTACTED', 'INTERESTED', 'LOST'],
  INTERESTED: ['VISITED', 'LOST'],
  LOST: ['NEW'],
  CONVERTED: [],
  DO_NOT_CONTACT: [],
};

export function isTerminal(status: ProspectStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** May a person set `to` by hand (PATCH status)? NEW to VISITED comes from a GPS check-in only. */
export function canSetByHand(from: ProspectStatus, to: ProspectStatus): boolean {
  return TRANSITIONS[from].includes(to) && !(from === 'NEW' && to === 'VISITED');
}

/** The targets the "Ubah tahap" form offers: reopening a LOST row is a manager's call. */
export function statusTargets(from: ProspectStatus, manage: boolean): ProspectStatus[] {
  return PROSPECT_STATUSES.filter((to) => canSetByHand(from, to) && (from !== 'LOST' || manage));
}
