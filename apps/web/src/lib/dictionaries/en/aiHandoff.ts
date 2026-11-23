import { aiHandoff as base } from '../id/aiHandoff';

// English: mirrors the shape of id/aiHandoff.ts (the source of truth for keys).
export const aiHandoff: typeof base = {
  title: 'Sign in to HYDROMART AI',
  working: 'Connecting your account to HYDROMART AI…',
  badLink: 'This sign-in link is incomplete. Open the HYDROMART AI web and press Sign in again.',
  staffOnly: 'The HYDROMART AI web is for staff accounts only.',
  failed: 'Could not sign in to HYDROMART AI.',
  retry: 'Try again',
};
