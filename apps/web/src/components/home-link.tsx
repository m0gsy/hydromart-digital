'use client';

import { LinkButton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { consoleHome, isStaff } from '@/lib/roles';

/**
 * The way out of an error or 404 screen: the console for staff, the catalogue for everyone else.
 *
 * Both screens hard-coded `/products`. A kepala depot whose Ops app hit the
 * `useLocation` crash (#905) pressed "Ke katalog" and landed in the customer shop — and
 * `/products`, unlike `/`, does not send staff on — so the report read "staf kami masuk ke
 * customer padahal sudah terdaftar di ops" (2026-11-17, two depot staff). `consoleHome`
 * already knows which console this binary serves for the role.
 */
export function HomeLinkButton({ variant }: { variant?: 'secondary' }) {
  const { t } = useT();
  const { customer } = useAuth();
  const staff = customer && isStaff(customer.role) ? customer.role : null;
  return (
    <LinkButton href={staff ? consoleHome(staff) : '/products'} variant={variant}>
      {t(staff ? 'hrFix.notFound.toConsole' : 'hrFix.notFound.toCatalog')}
    </LinkButton>
  );
}
