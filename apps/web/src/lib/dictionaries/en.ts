import type { Dictionary } from './id';
import { home } from './en/home';
import { shop } from './en/shop';
import { order } from './en/order';
import { profile } from './en/profile';
import { auth } from './en/auth';
import { help } from './en/help';
import { notifications } from './en/notifications';
import { agen } from './en/agen';
import { onboarding } from './en/onboarding';
import { review } from './en/review';
import { subscriptions } from './en/subscriptions';
import { ops } from './en/ops';
import { dashboard } from './en/dashboard';
import { dashA } from './en/dashA';
import { dashB } from './en/dashB';
import { dashC } from './en/dashC';
import { driver } from './en/driver';
import { hq } from './en/hq';
import { privacy } from './en/privacy';
import { deleteAccount } from './en/deleteAccount';
import { franchise } from './en/franchise';
import { customerFix } from './en/customerFix';
import { courierFix } from './en/courierFix';
import { hqFix } from './en/hqFix';
import { opsFix } from './en/opsFix';
import { mgrFix } from './en/mgrFix';
import { hrFix } from './en/hrFix';
import { settings } from './en/settings';
import { errors } from './en/errors';

// English — mirrors the shape of id.ts (the source of truth for keys).
export const en: Dictionary = {
  nav: {
    home: 'Home',
    shop: 'Shop',
    orders: 'Orders',
    account: 'Account',
    cart: 'Cart',
    signIn: 'Sign in',
    ops: 'Operations',
  },
  account: {
    consents: {
      title: 'Data consent',
      body: 'A record of what you agreed to, and when. Mandatory consent cannot be withdrawn while the account is active — to stop entirely, request account deletion above.',
      mandatory: 'Required',
      never: 'Never asked',
      since: 'Since {date}',
      saved: 'Consent updated.',
      saveError: 'Could not update the consent.',
      purpose: {
        TERMS: 'Terms of service',
        PRIVACY: 'Privacy policy & data processing',
        MARKETING: 'Promotions and offers',
      },
    },
    devices: {
      title: 'Devices & sessions',
      body: 'Every device that can still sign in to your account. Sign one out, or all of them at once if your phone is lost.',
      thisDevice: 'This device',
      unknownDevice: 'Unrecognised device',
      since: 'Signed in {date}',
      expires: 'Valid until {date}',
      revoke: 'Sign out',
      revoked: 'Device signed out.',
      revokeError: 'Could not sign that device out.',
      logoutAll: 'Sign out of all devices',
      logoutAllConfirm: 'Every device, including this one, will have to sign in again. Continue?',
      loggedOutAll: 'All devices signed out.',
      logoutAllError: 'Could not sign out of all devices.',
      empty: 'No active sessions.',
      loadError: 'Could not load your devices.',
    },
    consentHistory: {
      title: 'Consent history',
      show: 'Show history',
      hide: 'Hide history',
      granted: 'Granted',
      withdrawn: 'Withdrawn',
      version: 'version {v}',
      via: 'via {source}',
      empty: 'No decision recorded yet.',
      loadError: 'Could not load your consent history.',
    },
    consentPending: {
      title: 'The terms and privacy text have changed',
      body: 'Your consent is on file against the older wording. Version {v} is the one in force — read it, then re-confirm if you agree.',
      unenforced:
        'This is a notice, nothing more. Your account stays active and your orders stay valid if you never re-confirm — nothing is blocked, downgraded or signed out.',
      accept: 'Accept the current text',
    },
    privacyData: {
      title: 'My personal data',
      body: 'You may ask for a copy of the data we hold, or ask for your account to be deleted. Head office reviews every request first, within 3x24 hours of it being sent (UU PDP No. 27/2022).',
      deadline: 'Answered by {date} at the latest',
      overdue: 'Past the 3x24-hour limit',
      requestExport: 'Request a data copy',
      requestDelete: 'Request account deletion',
      deleteConfirm: 'Your account and identity are permanently removed once approved. Payment history is kept without your identity because tax law requires it. Continue?',
      submitted: 'Request sent. Head office will review it.',
      submitError: 'Could not send the request.',
      empty: 'No requests yet.',
      download: 'Download my data',
      downloadError: 'Could not download the data copy.',
      type: { EXPORT: 'Data copy', DELETE: 'Delete account' },
      status: { PENDING: 'Awaiting review', COMPLETED: 'Done', REJECTED: 'Rejected' },
    },
    title: 'Account & settings',
    profile: 'Profile',
    orders: 'My orders',
    addresses: 'Addresses',
    rewards: 'Rewards & points',
    ops: 'Operations dashboard',
    language: 'Language',
    logout: 'Sign out',
    guestTitle: 'Sign in to your account',
    guestBody: 'Sign in to see your orders, addresses, and reward points.',
    version: 'Hydromart v{v}',
    nav: {
      profile: 'Profile',
      addresses: 'Addresses',
      payments: 'Payments',
      orders: 'Orders',
      rewards: 'Rewards',
      favorites: 'Favorites',
      referral: 'Invite friends',
      prefs: 'Notifications',
    },
    profileCard: {
      title: 'Profile',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      name: 'Full name',
      phone: 'Phone number',
      email: 'Email',
      emailOptional: '(optional)',
      // H16: the first screen in the app that has ever asked for a date of birth.
      birthdate: 'Date of birth',
      birthdateHint: 'Optional. Used for the birthday reward; you can clear it at any time.',
      emailEmpty: 'Not set',
      saved: 'Profile updated.',
      saveError: 'Could not save profile.',
    },
    payments: {
      title: 'Payment methods',
      add: 'Add',
      empty: 'No saved methods yet.',
      default: 'Active',
      makeDefault: 'Set as default',
      delete: 'Delete',
      sheetTitle: 'Add payment method',
      type: 'Type',
      label: 'Name',
      labelHint: 'e.g. GoPay, BCA',
      masked: 'Last digits',
      maskedHint: 'Optional, e.g. ••••4821',
      save: 'Save',
      addError: 'Could not save method.',
    },
    addressesCard: {
      title: 'Saved addresses',
      manage: 'Manage',
      add: 'Add address',
      empty: 'No saved addresses yet.',
      primary: 'Primary',
    },
    prefs: {
      title: 'Preferences',
      // F6: two states that had no words, because the switch never actually asked the
      // device anything.
      push: {
        title: 'Order notifications',
        body: 'Delivery & courier status updates.',
        unsupported: 'This device cannot receive notifications.',
        denied: 'Notifications are blocked. Allow Hydromart in your device settings, then try again.',
        failed: 'Could not register this device for notifications. Try again.',
      },
      marketing: { title: 'Promos & offers', body: 'Deals from your depot. Turn off any time.' },
      saveError: 'Could not save preferences.',
    },
    languageBody: 'App language',
    theme: 'Theme',
    themeBody: 'Light or dark appearance',
    theme_light: 'Light',
    theme_dark: 'Dark',
    theme_system: 'System',
  },
  common: {
    confirm: 'Confirm',
    confirmTitle: 'Confirm this action',
    reason: 'Reason',
    cancel: 'Cancel',
    close: 'Close',
    done: 'Done',
    back: 'Back',
    retry: 'Try again',
    loading: 'Loading…',
    somethingWrong: 'Something went wrong',
    loadFailed: 'Could not load.',
    error: 'Something went wrong.',
    netUnreachable: 'Cannot reach the server. Check your connection and try again.',
    netTimeout: 'The server took too long to answer. Try again.',
    netTooMany: 'Too many requests right now. Wait a moment and try again.',
    netFailed: 'Request failed ({status}).',
    loadMore: 'Load more',
    shownOfTotal: 'Showing {shown} of {total}',
  },
  home,
  shop,
  order,
  profile,
  auth,
  help,
  notifications,
  agen,
  onboarding,
  review,
  subscriptions,
  ops,
  dashboard,
  dashA,
  dashB,
  dashC,
  driver,
  hq,
  privacy,
  deleteAccount,
  franchise,
  customerFix,
  courierFix,
  hqFix,
  opsFix,
  mgrFix,
  hrFix,
  settings,
  errors,
};
