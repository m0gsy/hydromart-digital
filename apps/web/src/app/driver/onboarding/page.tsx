'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Bank,
  Camera,
  Check,
  Drop,
  Fingerprint,
  HandCoins,
  Headset,
  Money,
  PencilLine,
  SealCheck,
  type Icon,
} from '@phosphor-icons/react';

import { ONBOARDED_KEY } from './constants';

interface Step {
  icon: Icon;
  title: string;
  body: React.ReactNode;
  bullets?: { icon: Icon; text: string }[];
  cta: string;
}

const STEPS: Step[] = [
  {
    icon: Drop,
    title: 'Selamat datang, kurir Hydromart! 👋',
    body: 'Kami antar air bersih ke ribuan pelanggan tiap hari. Yuk kenali cara kerja aplikasi dalam 4 langkah singkat.',
    cta: 'Mulai kenalan',
  },
  {
    icon: SealCheck,
    title: 'Selalu ambil bukti antar',
    body: (
      <>
        Setiap pengantaran wajib <strong>foto barang</strong>, <strong>tanda tangan penerima</strong>,
        dan lokasi GPS. Ini melindungi kamu bila ada komplain.
      </>
    ),
    bullets: [
      { icon: Camera, text: 'Foto pengantaran jelas' },
      { icon: PencilLine, text: 'Tanda tangan penerima asli' },
    ],
    cta: 'Lanjut',
  },
  {
    icon: HandCoins,
    title: 'Kelola uang COD dengan rapi',
    body: (
      <>
        Terima tunai, aplikasi hitung <strong>kembalian otomatis</strong>. Di akhir shift,{' '}
        <strong>setor semua uang COD</strong> ke depot — selisih tercatat jelas.
      </>
    ),
    bullets: [
      { icon: Money, text: 'Kembalian dihitung otomatis' },
      { icon: Bank, text: 'Setor tunai akhir shift' },
    ],
    cta: 'Lanjut',
  },
  {
    icon: Check,
    title: 'Kamu siap jalan! 🚚',
    body: (
      <>
        Datang ke depot dan <strong>check-in</strong> untuk mulai shift &amp; menerima tugas pertamamu.
        Semangat mengantar!
      </>
    ),
    bullets: [
      { icon: Fingerprint, text: 'Check-in di depot tiap mulai shift' },
      { icon: Headset, text: 'Butuh bantuan? Hubungi admin depot' },
    ],
    cta: 'Mulai shift · check-in',
  },
];

export default function DriverOnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;

  const finish = () => {
    localStorage.setItem(ONBOARDED_KEY, '1');
    router.replace('/driver/shift/check-in');
  };

  const s = STEPS[step]!;
  const StepIcon = s.icon;

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-brand-700 to-brand-600 px-6 pb-8 pt-4 text-on-brand">
      <div className="flex items-center justify-between py-3">
        <div className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full ${i === step ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </div>
        {!last && (
          <button type="button" className="text-sm font-bold text-white/80" onClick={finish}>
            Lewati
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div
          className={`flex size-[150px] items-center justify-center bg-white/15 backdrop-blur ${last ? 'rounded-full' : 'rounded-[40px]'}`}
        >
          {last ? (
            <span className="flex size-[104px] items-center justify-center rounded-full bg-white">
              <StepIcon size={56} weight="fill" className="text-brand-700" />
            </span>
          ) : (
            <StepIcon size={74} weight="fill" className="text-white" />
          )}
        </div>
        <h1 className="mt-9 text-2xl font-extrabold tracking-tight">{s.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/90">{s.body}</p>

        {s.bullets && (
          <div className="mt-7 flex w-full flex-col gap-2.5">
            {s.bullets.map((b) => {
              const BIcon = b.icon;
              return (
                <div
                  key={b.text}
                  className="flex items-center gap-3 rounded-2xl bg-white/15 px-4 py-3 text-left"
                >
                  <BIcon size={20} weight="fill" className="text-white" />
                  <span className="text-sm font-bold">{b.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => (last ? finish() : setStep((n) => n + 1))}
        className="flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-extrabold text-brand-700"
      >
        {last && <Fingerprint size={19} weight="fill" />}
        {s.cta}
        {!last && <ArrowRight size={17} weight="bold" />}
      </button>
      <div className="mt-3.5 text-center text-xs font-bold text-white/75">
        Langkah {step + 1} dari {STEPS.length}
      </div>
    </div>
  );
}
