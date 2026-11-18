import Link from 'next/link';

/*
 * The tab strip itself, shared by the depot and head-office hubs (PR-3c). Its own file, with no
 * nav table in it: the HQ layout imports it, and taking it from the depot HubTabs module pulled
 * the whole depot table and its icons into every /hq page, the HQ login included.
 */
/** Nothing for one tab. */
export function HubTabBar({
  label,
  current,
  tabs,
}: {
  label: string;
  current: string;
  tabs: { href: string; label: string }[];
}) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((tab) => {
        const on = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? 'page' : undefined}
            className={
              'inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors ' +
              (on
                ? 'bg-brand-50 text-brand-800'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--surface-soft)]')
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
