'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChatCircleText,
  type Icon,
  MagnifyingGlass,
  Minus,
  Money,
  Phone,
  PhoneCall,
  Plus,
  SealCheck,
  Truck,
  Wallet,
  WarningOctagon,
} from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card } from '@/components/ui';

// ponytail: depot emergency line is one placeholder — no per-depot CS routing in
// scope. Wire to depot config when a real hotline exists (mirrors customer /help).
const DEPOT_PHONE = '+62 812-9000-0100';
const WA_LINK = `https://wa.me/${DEPOT_PHONE.replace(/[^0-9]/g, '')}`;

const CATEGORIES: { icon: Icon; label: string }[] = [
  { icon: SealCheck, label: 'Bukti antar' },
  { icon: Money, label: 'COD & setoran' },
  { icon: Wallet, label: 'Penghasilan' },
  { icon: Truck, label: 'Shift & tugas' },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Foto atau tanda tangan gagal terunggah?',
    a: 'Cek sinyal, lalu tekan Coba lagi. Bukti tersimpan sementara di HP dan terunggah otomatis saat online — pengantaran tidak akan hilang.',
  },
  {
    q: 'Pelanggan tidak di tempat, harus apa?',
    a: 'Hubungi pelanggan lewat telepon dan WhatsApp, tunggu di lokasi minimal 5 menit. Jika tetap tak ada respons, tandai "Tidak di tempat" lalu jadwalkan ulang atau tandai gagal.',
  },
  {
    q: 'Setoran COD saya selisih, kenapa?',
    a: 'Selisih muncul bila jumlah tunai yang disetor tidak sama dengan total COD yang tercatat sistem. Kekurangan menjadi tanggungan kurir dan tercatat di rincian pendapatan.',
  },
  {
    q: 'Kapan payout mingguan cair?',
    a: 'Saldo pendapatan bisa ditarik kapan saja dari menu Pendapatan. Penarikan diproses ke rekening terdaftar sesuai jadwal payout depot.',
  },
  {
    q: 'Galon bocor di jalan, lapor ke mana?',
    a: 'Buka Lapor insiden di profil, pilih kategori kerusakan barang. Insiden berat otomatis diteruskan ke ops depot.',
  },
];

function Help() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(0);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? FAQ.map((row, i) => ({ row, i })).filter(({ row }) =>
            (row.q + row.a).toLowerCase().includes(q),
          )
        : FAQ.map((row, i) => ({ row, i })),
    [q],
  );

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 text-sm font-extrabold">Bantuan &amp; FAQ</div>
      </header>

      <label className="flex h-12 items-center gap-2 rounded-[14px] border border-[color:var(--border)] bg-white px-4">
        <MagnifyingGlass size={17} className="text-[color:var(--muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari bantuan…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--muted)]"
        />
      </label>

      <div className="grid grid-cols-2 gap-2.5">
        {CATEGORIES.map((c) => {
          const CIcon = c.icon;
          return (
            <Card key={c.label} className="p-3.5">
              <CIcon size={22} weight="fill" className="text-brand-700" />
              <div className="mt-2 text-[12.5px] font-extrabold">{c.label}</div>
            </Card>
          );
        })}
      </div>

      <div className="px-1 pt-1 text-[11px] font-extrabold uppercase tracking-wide text-[color:var(--muted)]">
        Sering ditanya
      </div>
      <Card className="divide-y divide-[color:var(--border)] p-0">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-[color:var(--muted)]">
            Tidak ada hasil untuk “{query}”.
          </div>
        ) : (
          filtered.map(({ row, i }) => {
            const isOpen = open === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                className="block w-full px-4 py-3.5 text-left"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`flex-1 text-[13px] ${isOpen ? 'font-extrabold' : 'font-bold'}`}>
                    {row.q}
                  </span>
                  {isOpen ? (
                    <Minus size={15} weight="bold" className="text-brand-700" />
                  ) : (
                    <Plus size={15} className="text-[color:var(--muted)]" />
                  )}
                </div>
                {isOpen && (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[color:var(--muted)]">{row.a}</p>
                )}
              </button>
            );
          })
        )}
      </Card>

      <Card className="bg-gradient-to-br from-brand-700 to-brand-600 p-4 text-on-brand">
        <div className="flex items-center gap-2.5">
          <PhoneCall size={22} weight="fill" />
          <div className="flex-1">
            <div className="text-[13.5px] font-extrabold">Kontak darurat depot</div>
            <div className="text-[11.5px] opacity-85">Aktif jam operasional</div>
          </div>
        </div>
        <div className="mt-3 flex gap-2.5">
          <a
            href={`tel:${DEPOT_PHONE.replace(/\s/g, '')}`}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white text-[13px] font-extrabold text-brand-700"
          >
            <Phone size={16} weight="fill" />
            Telepon
          </a>
          <a
            href={WA_LINK}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/20 text-[13px] font-extrabold"
          >
            <ChatCircleText size={16} weight="fill" />
            Chat admin
          </a>
        </div>
      </Card>

      <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-[11.5px] leading-snug text-red-800">
        <WarningOctagon size={18} weight="fill" className="shrink-0 text-red-600" />
        Kecelakaan / keadaan darurat? Lapor insiden dengan tingkat <strong>&nbsp;berat&nbsp;</strong> — lokasi
        terkirim ke depot &amp; ops.
      </div>
    </div>
  );
}

export default function DriverHelpPage() {
  return (
    <DriverShell nav={false}>
      <Help />
    </DriverShell>
  );
}
