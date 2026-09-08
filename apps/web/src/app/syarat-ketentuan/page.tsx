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
      {/* CA-3-51: hidden below `sm:` because the app bar now carries this title there —
          the rule `screen-chrome.ts:24-27` states, and the idiom /help and /notifications
          use. Rendering both is how /kebijakan-privasi ended up saying its name twice. */}
      <h1 className="hidden text-[22px] font-extrabold tracking-[-0.02em] sm:block">{title}</h1>
      <TermsBody />
    </div>
  );
}
