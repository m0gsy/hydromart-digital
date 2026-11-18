import Link from 'next/link';
import type { ReactNode } from 'react';

/** PR-2: the name as a link when `entityHref` gave a door, the same text when it gave none. */
export function EntityLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link href={href} className="text-brand-700 underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
