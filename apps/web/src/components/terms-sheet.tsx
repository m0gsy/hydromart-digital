'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { useT } from '@/lib/locale-context';

/*
 * Loaded on demand, not with the page that links to it.
 *
 * The terms are eighteen clauses in two languages, and the screen that carries this link is
 * the register form — one of the four pages the Lighthouse ratchet weighs. Importing the body
 * statically put /login 3.5 kB over its byte ceiling on the very first CI run, which is the
 * ratchet doing precisely its job: the text is only ever needed by somebody who opens it.
 *
 * `ssr: false` because this only ever renders inside an opened Sheet, which is client-side by
 * construction; there is nothing for the server to pre-render.
 */
const TermsBody = dynamic(() => import('./terms-body').then((m) => m.TermsBody), { ssr: false });

/**
 * The words "Ketentuan Layanan" inside a sentence, which open the terms over the page.
 *
 * A button, not an anchor: it goes nowhere. `preventDefault` because on the register form
 * these words sit inside the `<label>` of the consent checkbox, so a plain click would open
 * the terms and tick "I agree" in one gesture — and consent has to be the reader's own act.
 *
 * A sheet rather than navigation, for the same reason as the privacy one: the registration
 * form is unmounted on the way to another route, so a visitor who reads the terms comes back
 * to empty fields.
 */
export function TermsLink({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

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
      <Sheet open={open} onClose={() => setOpen(false)} title={t('auth.register.consentTerms')}>
        <TermsBody />
      </Sheet>
    </>
  );
}
