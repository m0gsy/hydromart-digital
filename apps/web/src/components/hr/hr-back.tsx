import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';

/**
 * PR-2b: the way back from an HR detail screen to its list. A link, not `router.back()`: a
 * screen opened from a push or a shared link has no history to go back to.
 */
export function HrBack({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
    >
      <ArrowLeft size={16} weight="bold" />
      {label}
    </Link>
  );
}
