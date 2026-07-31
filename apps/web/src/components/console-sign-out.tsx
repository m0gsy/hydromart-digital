'use client';

import { useRouter } from 'next/navigation';
import { SignOut } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';

/**
 * Sign out of a console. The consoles used to borrow the shop's top nav for this; now
 * that they render without it, the rails that have no profile page of their own (HQ, HR)
 * carry the exit themselves. Lands on the staff door, not the customer one.
 */
export function ConsoleSignOut() {
  const { signOut } = useAuth();
  const { t } = useT();
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        signOut();
        router.replace('/hq/login');
      }}
      className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-brand-50 hover:text-brand-700"
    >
      <SignOut size={20} />
      {t('dashC.profile.signOut')}
    </button>
  );
}
