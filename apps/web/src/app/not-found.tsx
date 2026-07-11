import Link from 'next/link';

// App Router 404 page — shown for unknown routes and notFound() calls.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Page not found</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
      </p>
      <Link
        href="/products"
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Go to catalog
      </Link>
    </main>
  );
}
