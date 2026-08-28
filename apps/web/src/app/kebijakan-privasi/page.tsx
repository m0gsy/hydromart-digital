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
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{title}</h1>
      <PrivacyBody />
    </div>
  );
}
