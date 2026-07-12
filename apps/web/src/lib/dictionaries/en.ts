import type { Dictionary } from './id';

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
    title: 'Account',
    profile: 'Profile',
    orders: 'My orders',
    addresses: 'Addresses',
    rewards: 'Rewards & points',
    ops: 'Operations dashboard',
    language: 'Language',
    logout: 'Sign out',
    guestTitle: 'Sign in to your account',
    guestBody: 'Sign in to see your orders, addresses, and reward points.',
  },
  common: {
    back: 'Back',
    retry: 'Try again',
    loading: 'Loading…',
    somethingWrong: 'Something went wrong',
  },
};
