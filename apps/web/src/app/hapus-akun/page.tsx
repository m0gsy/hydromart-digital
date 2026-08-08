'use client';

import Link from 'next/link';

import { useT } from '@/lib/locale-context';
import { deleteAccount as deleteID } from '@/lib/dictionaries/id/deleteAccount';
import { deleteAccount as deleteEN } from '@/lib/dictionaries/en/deleteAccount';

// Google Play requires a PUBLIC account-deletion URL: reachable without signing in and
// without installing the app, naming the developer, the apps it covers, the steps to
// request deletion, and what is kept versus erased. Missing it is a standard rejection.
// Same static shape as kebijakan-privasi/page.tsx — structured sections, so the locale
// fragment is picked directly rather than through t().
export default function DeleteAccountPage() {
  const { locale } = useT();
  const d = locale === 'en' ? deleteEN : deleteID;

  return (
    <div className="mx-auto max-w-[640px]">
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{d.title}</h1>
      <p className="mt-1 text-[12.5px] font-semibold text-muted">{d.effective}</p>
      <p className="mt-1 text-[12.5px] font-semibold text-muted">{d.developer}</p>
      <p className="mt-4 text-[14px] leading-relaxed">{d.intro}</p>

      <section className="mt-6">
        <h2 className="text-[15px] font-extrabold">{d.stepsHeading}</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-[13.5px] leading-relaxed text-muted">
          {d.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <div className="mt-6 space-y-5">
        {d.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-[15px] font-extrabold">{s.heading}</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
          </section>
        ))}
      </div>

      <p className="mt-8 text-[13px]">
        <Link href="/kebijakan-privasi" className="font-bold text-brand-600 hover:underline">
          {locale === 'en' ? 'Privacy Policy' : 'Kebijakan Privasi'}
        </Link>
      </p>
    </div>
  );
}
