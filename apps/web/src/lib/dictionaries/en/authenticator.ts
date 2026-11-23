import { authenticator as base } from '../id/authenticator';

// English: mirrors the shape of id/authenticator.ts (the source of truth for keys).
export const authenticator: typeof base = {
  back: 'Account',
  title: 'Authenticator app',
  intro:
    'A 6-digit code from the authenticator app on your phone is the second step when you sign in to the HYDROMART AI web.',
  required: 'Your role must use this step to sign in to the AI web.',
  optional:
    'Your role does not have to use it. Once set up, the step is required for you at every AI web sign-in, and only a SUPER_ADMIN can remove it.',
  unavailable: 'The authenticator step is not switched on on the server yet. There is nothing to set up.',
  staffOnly: 'The authenticator is for staff accounts only.',
  loadError: 'Could not load the authenticator status.',
  enrolled: 'Authenticator set up. Recovery codes left: {n}.',
  locked: 'Locked until {time} after too many wrong codes.',
  resetHint:
    'New phone, or lost the app? Ask a SUPER_ADMIN to reset your authenticator, then set it up here again.',
  start: 'Set up the authenticator',
  starting: 'Preparing…',
  step1: '1. Add this account to an authenticator app (Google Authenticator, Microsoft Authenticator or similar).',
  openInApp: 'Open in the authenticator app',
  typeSecret: 'Or type this key into the app:',
  step2: '2. Enter the 6-digit code the app shows, and the SMS code just sent to your account number.',
  appCode: 'Code from the app',
  smsCode: 'SMS code',
  smsSent: 'The SMS code went to your account number and is valid for {m} minutes.',
  smsPending: 'The SMS is on its way to your account number. If it does not come, start again.',
  restart: 'Start again',
  badAppCode: 'The app code is 6 digits.',
  badSmsCode: 'The SMS code is 4 to 8 digits.',
  confirm: 'Finish setting up',
  failed: 'Setting up failed. Try again.',
  codesTitle: 'Save these recovery codes now',
  codesBody:
    'Shown once only. Each code works once when your phone is not at hand. Keep them somewhere safe, not on the same phone.',
  copy: 'Copy all',
  copied: 'Recovery codes copied.',
  copyError: 'Could not copy. Write the codes down instead.',
  done: 'I have saved them',
};
