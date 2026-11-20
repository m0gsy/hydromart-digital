'use client';

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
 *
 * Its own module so `PrivacyLink` pulls it in only when somebody opens it: the courier's
 * signature screen carries the link, and /driver is one of the pages the Lighthouse ratchet
 * weighs, so the policy in two languages rode along on every courier load.
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
