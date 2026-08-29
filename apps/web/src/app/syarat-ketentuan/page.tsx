'use client';

import { TermsBody } from '@/components/terms-body';
import { useT } from '@/lib/locale-context';
import { terms as termsEN } from '@/lib/dictionaries/en/terms';
import { terms as termsID } from '@/lib/dictionaries/id/terms';

// Ketentuan Layanan. The body is shared with the consent sheet the register form opens —
// one copy, so an update cannot reach the page a reader browses to and miss the one a
// reader is asked to agree to. Same arrangement as /kebijakan-privasi.
//
// Rendered inside the root layout (nav + footer), so this is just the content column.
export default function TermsPage() {
  const { locale } = useT();
  const title = (locale === 'en' ? termsEN : termsID).title;

  return (
    <div className="mx-auto max-w-[640px]">
      <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{title}</h1>
      <TermsBody />
    </div>
  );
}
