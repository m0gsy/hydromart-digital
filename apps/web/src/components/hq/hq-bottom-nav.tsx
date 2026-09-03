'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { List, X, type Icon } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { isHq } from '@/lib/roles';
import { hqGroupsForRole, hqItemsForRole } from '@/lib/hq-nav';
// The rail's table, not a second one: /hq/sitemap already reads it the same way, and the
// bottom nav only ever renders on /hq pages where the rail module is loaded anyway.
import { HQ_ICONS } from '@/components/hq/hq-rail';
import { ConsoleSignOut } from '@/components/console-sign-out';

/*
 * CA-2-61. The tab bar used to be four hard-coded routes, and on a phone it was the WHOLE
 * of the HQ console's navigation: the rail is `hidden lg:flex`, and the command palette
 * opens on Ctrl+K or a rail button, neither of which a phone has. Sixty of the sixty-four
 * /hq screens could not be reached at all without typing a URL.
 *
 * One of the four was dead on arrival for almost everyone, too. `/hq/access` needs
 * `accessMatrixWrite`, which is SUPER_ADMIN alone — so head office, the director and
 * finance each had a permanent tab that led to a refusal. `/hq` itself needs `dashboard`,
 * which FINANCE does not hold: its FIRST tab was the dead one.
 *
 * Both come from the same mistake — a second, hand-written copy of a nav model that
 * already existed. `hqGroupsForRole` is what the rail, the page gate, the screen index and
 * the landing all read; this now reads it too, so a door hidden in one place cannot be
 * offered in another.
 */

/** Tabs shown on the bar itself. The rest live one tap away, behind "Lainnya". */
const TAB_COUNT = 3;

export function HqBottomNav() {
  const pathname = usePathname();
  const { customer } = useAuth();
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = customer?.role;

  // A route change closes the drawer — otherwise tapping a link leaves it covering the
  // page that was just opened.
  useEffect(() => setMenuOpen(false), [pathname]);

  // Hooks first: an early return above them changes the hook order between renders.
  if (!isHq(role)) return null;

  const groups = hqGroupsForRole(role);
  const tabs = hqItemsForRole(role).slice(0, TAB_COUNT);
  // A role with nothing to show gets no bar rather than an empty one. Not reachable
  // today — the console gate already refuses a role with no items — but a bar with a lone
  // "Lainnya" button opening an empty sheet is a worse answer than no bar.
  if (tabs.length === 0) return null;

  const isActive = (href: string) =>
    href === '/hq' ? pathname === '/hq' : pathname.startsWith(href);

  const item = (href: string, label: string, Ic: Icon, on: boolean, onClick?: () => void) => (
    <Link
      key={href}
      href={href}
      onClick={onClick}
      aria-current={on ? 'page' : undefined}
      className={
        // `flex-1`: four labels sharing the bar means a 78px target each; content-width made
        // "Akses" a 35px one, tall enough and too narrow to hit.
        'flex min-h-11 flex-1 flex-col items-center justify-center gap-[3px] text-[10px] font-extrabold transition-colors ' +
        (on ? 'text-brand-600' : 'text-[color:var(--text-muted)]')
      }
    >
      <Ic size={22} weight={on ? 'fill' : 'regular'} aria-hidden />
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );

  return (
    <>
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          role="presentation"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {menuOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-app bg-[color:var(--surface)] pb-[calc(72px+max(16px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom))))] lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t('hq.nav.allScreens')}
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-app bg-[color:var(--surface)] px-4 py-3">
            <h2 className="text-sm font-extrabold">{t('hq.nav.allScreens')}</h2>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label={t('hq.nav.closeMenu')}
              className="flex min-h-11 min-w-11 items-center justify-center text-[color:var(--text-muted)]"
            >
              <X size={20} aria-hidden />
            </button>
          </div>

          <nav className="px-2 py-2" aria-label={t('hq.nav.allScreens')}>
            {groups.map((group) => (
              <div key={group.headKey} className="mb-2">
                <p className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
                  {t(`hq.groups.${group.headKey}`)}
                </p>
                {group.items.map((i) => {
                  const Ic = HQ_ICONS[i.href] ?? List;
                  const on = isActive(i.href);
                  return (
                    <Link
                      key={i.href}
                      href={i.href}
                      aria-current={on ? 'page' : undefined}
                      className={
                        'flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold ' +
                        (on ? 'bg-brand-50 text-brand-600' : 'text-[color:var(--text)]')
                      }
                    >
                      <Ic size={18} weight={on ? 'fill' : 'regular'} aria-hidden />
                      <span className="truncate">{t(`hq.nav.${i.labelKey}`)}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
            {/*
             * CA-2-61: the way out. The rail carries a sign-out and the rail is desktop-only,
             * so on a phone the HQ console had no way to end a session at all.
             */}
            <div className="border-t border-app px-2 pt-3">
              <ConsoleSignOut />
            </div>
          </nav>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex max-w-[100vw] items-end justify-around overflow-hidden border-t border-app bg-[color:var(--surface)]/95 px-2 pb-[max(16px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] pt-2.5 backdrop-blur-[8px] lg:hidden"
        aria-label={t('hq.nav.aria')}
      >
        {tabs.map((tab) =>
          item(
            tab.href,
            t(`hq.nav.${tab.labelKey}`),
            HQ_ICONS[tab.href] ?? List,
            isActive(tab.href),
          ),
        )}
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
          <span className="max-w-full truncate">{t('hq.nav.more')}</span>
        </button>
      </nav>
    </>
  );
}
