import type { Dictionary } from './id';
import { home } from './en/home';
import { shop } from './en/shop';
import { order } from './en/order';
import { profile } from './en/profile';
import { auth } from './en/auth';

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
  home,
  shop,
  order,
  profile,
  auth,
};
