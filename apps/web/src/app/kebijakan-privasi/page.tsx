'use client';

import { useT } from '@/lib/locale-context';
import { privacy as privacyID } from '@/lib/dictionaries/id/privacy';
import { privacy as privacyEN } from '@/lib/dictionaries/en/privacy';

// Static privacy policy (UU PDP). Sections are structured (array), so pick the
// locale fragment directly rather than via t(). Rendered inside the root layout
// (nav + footer), so this is just the content column.
export default function PrivacyPolicyPage() {
  const { locale } = useT();
  const p = locale === 'en' ? privacyEN : privacyID;

  return (
    <div className="mx-auto max-w-[640px]">
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{p.title}</h1>
      <p className="mt-1 text-[12.5px] font-semibold text-muted">{p.effective}</p>
      <p className="mt-4 text-[14px] leading-relaxed">{p.intro}</p>

      <div className="mt-6 space-y-5">
        {p.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-[15px] font-extrabold">{s.heading}</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
