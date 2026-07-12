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
        <main style={{ textAlign: 'center', padding: '1.5rem', color: '#16282e' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: 800 }}>
            Ada yang tidak beres
          </h1>
          <p style={{ color: '#64757c', marginBottom: '1rem' }}>
            Aplikasi gagal dimuat. Silakan coba lagi.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#0c97ac',
              color: '#fff',
              border: 0,
              borderRadius: 999,
              padding: '0.625rem 1.25rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Coba lagi
          </button>
        </main>
      </body>
    </html>
  );
}
