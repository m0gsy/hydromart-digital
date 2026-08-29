'use client';

import { useT } from '@/lib/locale-context';
import { terms as termsEN } from '@/lib/dictionaries/en/terms';
import { terms as termsID } from '@/lib/dictionaries/id/terms';

/**
 * The Terms of Service, rendered where the reader already is.
 *
 * Its own module so `TermsLink` can pull it in only when somebody opens it. Eighteen clauses
 * in two languages is real weight, and the register screen — which carries the link — is one
 * of the pages the Lighthouse ratchet weighs. It caught this at +3.5 kB over the /login
 * ceiling on the first run, which is exactly what a byte ratchet is for.
 */
export function TermsBody() {
  const { locale } = useT();
  const t = locale === 'en' ? termsEN : termsID;

  return (
    <>
      <p className="mt-1 text-[12.5px] font-semibold text-muted">{t.effective}</p>
      <p className="mt-4 text-[14px] leading-relaxed">{t.intro}</p>
      <div className="mt-6 space-y-5">
        {t.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-[15px] font-extrabold">{s.heading}</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
          </section>
        ))}
      </div>
    </>
  );
}
