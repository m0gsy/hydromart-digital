import { LinkButton } from '@/components/ui';

// App Router 404 page — shown for unknown routes and notFound() calls.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-extrabold tracking-tight">Halaman tidak ditemukan</h1>
      <p className="text-sm text-muted">
        Halaman yang kamu cari tidak ada atau sudah dipindahkan.
      </p>
      <LinkButton href="/products">Ke katalog</LinkButton>
    </main>
  );
}
