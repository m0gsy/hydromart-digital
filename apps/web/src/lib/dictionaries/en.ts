import type { Dictionary } from './id';
import { home } from './en/home';
import { shop } from './en/shop';
import { order } from './en/order';
import { profile } from './en/profile';
import { auth } from './en/auth';
import { help } from './en/help';
import { notifications } from './en/notifications';
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
import { customerFix } from './en/customerFix';
import { courierFix } from './en/courierFix';
import { hqFix } from './en/hqFix';
import { opsFix } from './en/opsFix';
import { mgrFix } from './en/mgrFix';

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
      push: { title: 'Order notifications', body: 'Delivery & courier status updates.' },
      email: { title: 'Promo emails', body: 'Latest offers and discounts.' },
      whatsapp: { title: 'WhatsApp', body: 'Reminders and confirmations via WhatsApp.' },
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
    back: 'Back',
    retry: 'Try again',
    loading: 'Loading…',
    somethingWrong: 'Something went wrong',
  },
  home,
  shop,
  order,
  profile,
  auth,
  help,
  notifications,
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
  customerFix,
  courierFix,
  hqFix,
  opsFix,
  mgrFix,
};
