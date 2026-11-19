import {
  CalendarCheck,
  ChartLineUp,
  ChartPieSlice,
  ClipboardText,
  Factory,
  GearSix,
  Gift,
  HandCoins,
  Handshake,
  ListChecks,
  MapPin,
  Megaphone,
  Package,
  Storefront,
  Tag,
  UsersThree,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';

/**
 * The depot-console hubs' row icons, one per hub of `lib/ops-nav.ts`.
 *
 * Kept out of that table on purpose. The table is read by route-access, the head of depot's
 * bar and the hub tabs, and none of them draws an icon; while the icons sat in its rows, every
 * one of those callers bundled all of them (#938 measured `canOpenRoute` adding 44–53 kB to
 * four pages). Only the two surfaces that draw a hub row import this file: the rail and the
 * phone sheet.
 *
 * `HubKey` is what the table's `headKey` is typed as, so a hub with no icon here does not build.
 */
export const HUB_ICONS = {
  summary: ChartLineUp,
  orders: ClipboardText,
  counter: Storefront,
  tracking: MapPin,
  stock: Package,
  purchasing: Factory,
  cash: Wallet,
  approvals: ListChecks,
  customers: UsersThree,
  loyalty: Gift,
  marketing: Megaphone,
  catalog: Tag,
  commission: HandCoins,
  finance: ChartPieSlice,
  team: Handshake,
  settings: GearSix,
  myAttendance: CalendarCheck,
} satisfies Record<string, Icon>;

export type HubKey = keyof typeof HUB_ICONS;
