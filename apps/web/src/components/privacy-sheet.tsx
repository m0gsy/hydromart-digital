'use client';

import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { useT } from '@/lib/locale-context';
import { privacy as privacyEN } from '@/lib/dictionaries/en/privacy';
import { privacy as privacyID } from '@/lib/dictionaries/id/privacy';

/**
 * The privacy policy, rendered where the reader already is.
 *
 * Two places ask for consent and link to the policy so the reader can decide: the
 * registration form, and the recipient's signature on a delivery. Both used
 * `target="_blank"`, and in the Android WebView that is not a link at all — this repo
 * measured the behaviour once already and wrote it down in `lib/platform.ts`:
 *
 *   `target="_blank"` there either does nothing or replaces the app's own view with no
 *   way back
 *
 * Nothing is the case here, because Capacitor leaves `setSupportMultipleWindows` off.
 * So in the app the tap lands on nothing: a person is asked to agree to a policy they
 * cannot open. That is the consent path, and UU PDP is exactly what the policy is about.
 *
 * Navigating in-app instead would work and cost something real — the registration form
 * is unmounted on the way, so the visitor comes back to empty fields, and the courier
 * loses a signature already drawn. A sheet costs neither: no navigation happens, the
 * content is the same dictionary the page renders, and `Sheet` already answers the
 * Android back button (native-bridge dispatches an Escape).
 */
export function PrivacyBody() {
  const { locale } = useT();
  const p = locale === 'en' ? privacyEN : privacyID;

  return (
    <>
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
    </>
  );
}

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
  const { locale } = useT();
  const [open, setOpen] = useState(false);
  const title = (locale === 'en' ? privacyEN : privacyID).title;

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
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <PrivacyBody />
      </Sheet>
    </>
  );
}
