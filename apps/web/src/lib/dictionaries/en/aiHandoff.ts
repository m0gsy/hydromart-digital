import { aiHandoff as base } from '../id/aiHandoff';

// English: mirrors the shape of id/aiHandoff.ts (the source of truth for keys).
export const aiHandoff: typeof base = {
  title: 'Sign in to HYDROMART AI',
  working: 'Connecting your account to HYDROMART AI…',
  badLink: 'This sign-in link is incomplete. Open the HYDROMART AI web and press Sign in again.',
  staffOnly: 'The HYDROMART AI web is for staff accounts only.',
  failed: 'Could not sign in to HYDROMART AI.',
  retry: 'Try again',
  ask: 'Sign in to the HYDROMART AI web as {name}? Continue only if you just pressed Sign in there yourself.',
  continue: 'Continue',
  tanya: 'Ask AI',
  tanyaDepot: 'Ask AI about this depot',
  tanyaHelp:
    'The Supervisor assistant on the AI web: priority depots to visit, follow-ups and depot figures.',
};
