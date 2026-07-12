import { Clock, Drop, ShieldCheck, Wallet } from '@phosphor-icons/react';

// Real, defensible trust signals — not testimonials. No customer data / no
// fabricated quotes: just the guarantees and payment options the platform
// actually offers. Static content.

const SIGNALS: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <Clock size={24} weight="fill" className="text-brand-600" />,
    title: 'Antar cepat dari depot terdekat',
    body: 'Pesanan diteruskan ke depot terdekat untuk pengiriman yang lebih cepat.',
  },
  {
    icon: <Drop size={24} weight="fill" className="text-brand-600" />,
    title: 'Air terjamin & tersegel',
    body: 'Galon dan botol tersegel, dari depot air minum resmi.',
  },
  {
    icon: <ShieldCheck size={24} weight="fill" className="text-brand-600" />,
    title: 'Bayar aman',
    body: 'Konfirmasi pembayaran sebelum pesanan diproses.',
  },
  {
    icon: <Wallet size={24} weight="fill" className="text-brand-600" />,
    title: 'Banyak metode bayar',
    body: 'Tunai (COD), transfer, QRIS, e-wallet, dan virtual account.',
  },
];

export function TrustIndicators() {
  return (
    <section className="flex flex-col gap-2" aria-label="Kenapa Hydromart">
      <h2 className="text-lg font-bold">Kenapa pesan di Hydromart</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SIGNALS.map((s) => (
          <div key={s.title} className="surface flex flex-col gap-2 rounded-xl border border-app p-4">
            {s.icon}
            <h3 className="font-semibold">{s.title}</h3>
            <p className="text-sm text-muted">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
