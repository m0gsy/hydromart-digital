// Pure helpers for the campaign console. Covered by test/campaigns.test.ts.

import type { RecipientInput } from './types';

/**
 * Parse the recipient textarea (one per line, `phone` or `phone,name`) into
 * API recipients. Blank lines are skipped; the first comma splits phone from
 * name (extra commas fold into the name). Phone-format validation is left to
 * the server (crm-service rejects malformed numbers).
 */
export function parseRecipients(text: string): RecipientInput[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const comma = line.indexOf(',');
      if (comma === -1) return { phone: line };
      const phone = line.slice(0, comma).trim();
      const name = line.slice(comma + 1).trim();
      return name ? { phone, name } : { phone };
    });
}
