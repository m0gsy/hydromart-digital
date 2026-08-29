'use client';

import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { useT } from '@/lib/locale-context';
import { terms as termsEN } from '@/lib/dictionaries/en/terms';
import { terms as termsID } from '@/lib/dictionaries/id/terms';

/**
 * The Terms of Service, rendered where the reader already is.
 *
 * The other half of the consent sentence. `PrivacyLink` was built for the first half after
 * measuring that `target="_blank"` is not a link at all inside the Android WebView; this is
 * the same treatment for the second, which until now was not even a link — it was plain
 * text naming a document that answered 404.
 *
 * A sheet rather than navigation, for the same reason as the privacy one: the registration
 * form is unmounted on the way to another route, so a visitor who reads the terms comes back
 * to empty fields.
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

/**
 * The words "Ketentuan Layanan" inside a sentence, which open the terms over the page.
 *
 * A button, not an anchor: it goes nowhere. `preventDefault` because on the register form
 * these words sit inside the `<label>` of the consent checkbox, so a plain click would open
 * the terms and tick "I agree" in one gesture — and consent has to be the reader's own act.
 */
export function TermsLink({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { locale } = useT();
  const [open, setOpen] = useState(false);
  const title = (locale === 'en' ? termsEN : termsID).title;

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={className ?? 'font-bold text-brand-600 underline hover:underline'}
      >
        {children}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <TermsBody />
      </Sheet>
    </>
  );
}
