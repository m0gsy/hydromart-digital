'use client';

import { Sparkle } from '@phosphor-icons/react';

import { ExternalLink } from '@/components/external-link';
import { useAuth } from '@/lib/auth-context';
import { aiHandoff as copyEN } from '@/lib/dictionaries/en/aiHandoff';
import { aiHandoff as copyID } from '@/lib/dictionaries/id/aiHandoff';
import { useT } from '@/lib/locale-context';
import { isCustomerApp } from '@/lib/platform';

// HD-19: the roles the AI web's Supervisor assistant (/asisten/supervisor) opens for.
// ponytail: Kepala depot and STAFF_DEPOT are left out on purpose (they would land on "belum
// punya akses"); the later Sales Performance assistant is where Kepala depot gets this button.
const SUPERVISOR_AI_ROLES = new Set([
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'HEAD_OFFICE',
  'DIREKTUR',
  'SUPER_ADMIN',
]);

/** The Supervisor assistant on the AI web (origin is build-time config), one depot when given; null when not set up. */
export function askAiUrl(depotId?: string): string | null {
  const base = (process.env.NEXT_PUBLIC_AI_WEB_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/asisten/supervisor${depotId ? `?depot=${encodeURIComponent(depotId)}` : ''}`;
}

function useAskAi(depotId?: string) {
  const { customer } = useAuth();
  const { locale } = useT();
  const allowed = SUPERVISOR_AI_ROLES.has(customer?.role ?? '') && !isCustomerApp();
  return { href: allowed ? askAiUrl(depotId) : null, copy: locale === 'en' ? copyEN : copyID };
}

/** The menu entry (rail and phone sheet): "Tanya AI" with its one-line helper. */
export function AskAiEntry({ onNavigate }: { onNavigate?: () => void }) {
  const { href, copy } = useAskAi();
  if (!href) return null;
  return (
    <ExternalLink
      href={href}
      onClick={onNavigate}
      className="flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] font-semibold hover:bg-[color:var(--surface-soft)]"
    >
      <Sparkle size={18} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
      <span className="leading-tight">
        {copy.tanya}
        <span className="block text-[11px] font-normal text-muted">{copy.tanyaHelp}</span>
      </span>
    </ExternalLink>
  );
}

/** On a visit screen: the same assistant, focused on the depot in context. */
export function AskAiDepotLink({ depotId }: { depotId: string }) {
  const { href, copy } = useAskAi(depotId);
  if (!href) return null;
  return (
    <ExternalLink href={href} className="block text-sm font-semibold text-brand-700">
      {copy.tanyaDepot}
    </ExternalLink>
  );
}
