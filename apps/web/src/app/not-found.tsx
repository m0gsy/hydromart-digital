'use client';

// A client component ONLY because it reads its copy through useT(); the 404 itself has
// nothing dynamic. LocaleProvider lives in the root layout, so it is in scope here.
import { LinkButton } from '@/components/ui';
import { useT } from '@/lib/locale-context';

// App Router 404 page — shown for unknown routes and notFound() calls.
export default function NotFound() {
  const { t } = useT();
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-extrabold tracking-tight">{t('hrFix.notFound.title')}</h1>
      <p className="text-sm text-muted">
        {t('hrFix.notFound.body2')}
      </p>
      <LinkButton href="/products">{t('hrFix.notFound.toCatalog')}</LinkButton>
    </main>
  );
}
