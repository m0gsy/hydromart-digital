import type { Capability } from '@hydromart/access';

/** AI-7c: whoever holds this is asked to grant an AI access request (SUPER_ADMIN by default). */
export const AI_ACCESS_CAPABILITY: Capability = 'legalEntityAiAccess';

/** What each data group of the AI web is called in the request's words. */
const GROUP_LABEL: Record<string, string> = {
  scope: 'cakupan data',
  money: 'data keuangan',
  stock: 'data stok',
  loyalty: 'data loyalitas',
  franchise: 'data waralaba',
  hr: 'data SDM',
  customers: 'data pelanggan',
  delivery: 'data pengiriman',
  gallons: 'data galon',
};

/** One line of visible text: whatever a name carries, a newline or invisible character is not in the message. */
export const oneLine = (value: string): string =>
  value
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();

/**
 * Who asked and for what, in Indonesian and plain. No name on file reads "Seorang staf"; the
 * role is said as its code ("HEAD OFFICE"). The entities, when named, win over the data group.
 */
export function accessRequestText(
  requester: { fullName: string | null; role: string },
  entityNames: readonly string[],
  group?: string,
): { who: string; what: string } {
  const name = requester.fullName ? oneLine(requester.fullName) : '';
  const role = requester.role.replace(/_/g, ' ');
  const names = entityNames.map(oneLine).filter(Boolean);
  return {
    who: name ? `${name} (${role})` : `Seorang staf (${role})`,
    what:
      names.length > 0
        ? names.join(', ')
        : (group && GROUP_LABEL[group]) || 'data yang belum diizinkan',
  };
}
