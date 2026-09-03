'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { List, X } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
// The rail's own table, not a second one: two copies of a nav model is how a door gets
// hidden in one place and offered in another. Same gates, same order.
import { hrNavItems } from '@/components/hr/hr-rail';
import { ConsoleSignOut } from '@/components/console-sign-out';

/*
 * CA-1-33. The HR rail is `hidden sm:flex` and was the WHOLE of this console's navigation,
 * so below 640px there was none at all: every one of its twenty screens could only be
 * reached by typing a URL, and there was no way to sign out either — the sign-out button
 * lives in the rail.
 *
 * HQ had the identical defect and CA-2-61 fixed it exactly this way, down to reading the
 * rail's own model rather than a second hand-written one. This is that fix, for HR.
 */

/** Tabs on the bar itself. The rest live one tap away, behind "Lainnya". */
const TAB_COUNT = 3;

export function HrBottomNav() {
  const pathname = usePathname();
  const { customer } = useAuth();
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  // A route change closes the drawer — otherwise tapping a link leaves it covering the
  // page that was just opened.
  useEffect(() => setMenuOpen(false), [pathname]);

  const items = hrNavItems(customer?.role);
  // A reader with nothing to show gets no bar rather than an empty one.
  if (items.length === 0) return null;

  const isActive = (href: string) =>
    href === '/hr' ? pathname === '/hr' : pathname.startsWith(href);
  const tabs = items.slice(0, TAB_COUNT);

  return (
    <>
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 sm:hidden"
          role="presentation"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {menuOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-app bg-[color:var(--surface)] pb-[calc(72px+max(16px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom))))] sm:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t('hrFix.nav.allScreens')}
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-app bg-[color:var(--surface)] px-4 py-3">
            <h2 className="text-sm font-extrabold">{t('hrFix.nav.allScreens')}</h2>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label={t('hrFix.nav.closeMenu')}
              className="flex min-h-11 min-w-11 items-center justify-center text-[color:var(--text-muted)]"
            >
              <X size={20} aria-hidden />
            </button>
          </div>

          <nav className="px-2 py-2" aria-label={t('hrFix.nav.allScreens')}>
            {items.map(({ href, label, icon: Icon }) => {
              const on = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={on ? 'page' : undefined}
                  className={
                    'flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold ' +
                    (on ? 'bg-brand-50 text-brand-600' : 'text-[color:var(--text)]')
                  }
                >
                  <Icon size={18} weight={on ? 'fill' : 'regular'} aria-hidden />
                  <span className="truncate">{t(label)}</span>
                </Link>
              );
            })}
            {/*
             * CA-1-33: the way out. Sign-out lives in the rail, and the rail is
             * desktop-only — so on a phone this console could not end a session at all.
             */}
            <div className="border-t border-app px-2 pt-3">
              <ConsoleSignOut />
            </div>
          </nav>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex max-w-[100vw] items-end justify-around overflow-hidden border-t border-app bg-[color:var(--surface)]/95 px-2 pb-[max(16px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] pt-2.5 backdrop-blur-[8px] sm:hidden"
        aria-label={t('hrFix.nav.aria')}
      >
        {tabs.map(({ href, label, icon: Icon }) => {
          const on = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? 'page' : undefined}
              className={
                // `flex-1`: labels sharing the bar need a thumb-sized target each, and
                // content width makes the short ones too narrow to hit.
                'flex min-h-11 flex-1 flex-col items-center justify-center gap-[3px] text-[10px] font-extrabold transition-colors ' +
                (on ? 'text-brand-600' : 'text-[color:var(--text-muted)]')
              }
            >
              <Icon size={22} weight={on ? 'fill' : 'regular'} aria-hidden />
              <span className="max-w-full truncate">{t(label)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          className={
            'flex min-h-11 flex-1 flex-col items-center justify-center gap-[3px] text-[10px] font-extrabold transition-colors ' +
            (menuOpen ? 'text-brand-600' : 'text-[color:var(--text-muted)]')
          }
        >
          <List size={22} weight={menuOpen ? 'fill' : 'regular'} aria-hidden />
          <span className="max-w-full truncate">{t('hrFix.nav.more')}</span>
        </button>
      </nav>
    </>
  );
}
