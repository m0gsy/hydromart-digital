import { LinkButton } from '@/components/ui';
import { useT } from '@/lib/locale-context';

// App Router 404 page — shown for unknown routes and notFound() calls.
export default function NotFound() {
  const { t } = useT();
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-extrabold tracking-tight">{t('hrFix.notFound.title')}</h1>
      <p className="text-sm text-muted">
        Halaman yang kamu cari tidak ada atau sudah dipindahkan.
      </p>
      <LinkButton href="/products">{t('hrFix.notFound.toCatalog')}</LinkButton>
    </main>
  );
}
