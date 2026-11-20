'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { useT } from '@/lib/locale-context';

/*
 * Loaded on demand, not with the screen that links to it — the same as the terms sheet. The
 * policy is only ever read by somebody who opens it; `ssr: false` because it renders only
 * inside an opened Sheet.
 */
const PrivacyBody = dynamic(() => import('./privacy-body').then((m) => m.PrivacyBody), {
  ssr: false,
});

/**
 * The words "Kebijakan Privasi" inside a sentence, which open the policy over the page.
 *
 * A button, not an anchor: it goes nowhere. Styled to read as the link it replaces, and
 * `inline` so it still wraps mid-sentence the way the anchor did.
 */
export function PrivacyLink({
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
          /*
           * Both, and for two different reasons.
           *
           * `preventDefault` cancels LABEL ACTIVATION: on the register form these words sit
           * inside the `<label>` of the consent checkbox, so a plain click would open the
           * policy and tick "I agree" in the same gesture. Consent has to be the reader's
           * own act, and this is the one screen where that is the whole point.
           *
           * `stopPropagation` keeps it from reaching a parent that treats a click on the row
           * as a click on the row.
           */
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={className ?? 'font-bold text-brand-600 underline hover:underline'}
      >
        {children}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('privacy.title')}>
        <PrivacyBody />
      </Sheet>
    </>
  );
}
