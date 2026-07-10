'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChartLineUp, ChatCircleText, Drop, Gift, ShoppingCart, User } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { canViewCampaigns, canViewDashboard, isStaff } from '@/lib/roles';
import type { Cart } from '@/lib/types';

export function Nav() {
  const { customer, ready } = useAuth();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  // ponytail: cheap re-fetch of the cart count on navigation instead of a global
  // cart store. Upgrade to shared state if the badge needs to update mid-page.
  useEffect(() => {
    if (!customer) {
      setCount(0);
      return;
    }
    let alive = true;
    api
      .get<Cart>(endpoints.cart.view, true)
      .then((cart) => alive && setCount(cart.items.reduce((n, i) => n + i.quantity, 0)))
      .catch(() => alive && setCount(0));
    return () => {
      alive = false;
    };
  }, [customer, pathname]);

  return (
    <header className="surface sticky top-0 z-30 border-b border-app">
      <nav className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/products" className="flex items-center gap-2 font-bold">
          <Drop size={26} weight="fill" className="text-brand-600" />
          <span>Hydromart</span>
        </Link>

        <div className="flex items-center gap-1">
          <Link
            href="/cart"
            aria-label="Cart"
            className="relative rounded-lg p-2.5 hover:bg-brand-50"
          >
            <ShoppingCart size={22} />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
                {count}
              </span>
            )}
          </Link>
          {ready && customer ? (
            <>
              {canViewDashboard(customer.role) ? (
                <Link
                  href="/dashboard"
                  aria-label="Operations dashboard"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-brand-50"
                >
                  <ChartLineUp size={20} />
                  <span className="hidden sm:inline">Ops</span>
                </Link>
              ) : (
                isStaff(customer.role) && (
                  <Link
                    href="/dashboard/orders"
                    aria-label="Order queue"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-brand-50"
                  >
                    <ChartLineUp size={20} />
                    <span className="hidden sm:inline">Queue</span>
                  </Link>
                )
              )}
              {canViewCampaigns(customer.role) && (
                <Link
                  href="/dashboard/campaigns"
                  aria-label="Campaigns"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-brand-50"
                >
                  <ChatCircleText size={20} />
                  <span className="hidden sm:inline">Campaigns</span>
                </Link>
              )}
              <Link
                href="/rewards"
                aria-label="Rewards"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-brand-50"
              >
                <Gift size={20} />
                <span className="hidden sm:inline">Rewards</span>
              </Link>
              <Link
                href="/orders"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-brand-50"
              >
                <User size={20} />
                <span className="hidden sm:inline">Orders</span>
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
