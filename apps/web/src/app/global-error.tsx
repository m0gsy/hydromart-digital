'use client';

// Catches failures in the ROOT layout itself, where the normal error boundary and
// Tailwind/layout chrome may be unavailable — so it renders its own <html>/<body>
// with inline styles. Keep it dependency-free.
export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="id">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
        }}
      >
        <main style={{ textAlign: 'center', padding: '1.5rem' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#64748b', marginBottom: '1rem' }}>
            The app failed to load. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '0.5rem 1rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
