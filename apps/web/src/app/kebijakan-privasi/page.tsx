'use client';

import { PrivacyBody } from '@/components/privacy-sheet';
import { useT } from '@/lib/locale-context';
import { privacy as privacyEN } from '@/lib/dictionaries/en/privacy';
import { privacy as privacyID } from '@/lib/dictionaries/id/privacy';

// Static privacy policy (UU PDP). The body is shared with the consent sheet that the
// register form and the PoD signature open — one copy, so a policy update cannot reach
// the page a reader browses to and miss the one a reader is asked to agree to.
// Rendered inside the root layout (nav + footer), so this is just the content column.
export default function PrivacyPolicyPage() {
  const { locale } = useT();
  const title = (locale === 'en' ? privacyEN : privacyID).title;

  return (
    <div className="mx-auto max-w-[640px]">
      {/* Same one-line correction as /syarat-ketentuan beside it: this page has carried a
          PUSHED title since H4 and kept its own heading too, so a phone read it twice. */}
      <h1 className="hidden text-[22px] font-extrabold tracking-[-0.02em] sm:block">{title}</h1>
      <PrivacyBody />
    </div>
  );
}
