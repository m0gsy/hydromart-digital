import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { wa as waEn } from '@/lib/dictionaries/en/wa';
import { wa as waId } from '@/lib/dictionaries/id/wa';
import { qrPath } from '@/lib/wa-qr';

const repo = join(__dirname, '..', '..', '..');
const crmConsent = readFileSync(join(repo, 'services/crm-service/src/domain/wa-consent.ts'), 'utf8');

describe('WhatsApp consent text (HD-13)', () => {
  // The ledger records WA_CONSENT_TEXT_VERSION against the text the customer saw. A text change in one place
  // only would record a consent for words nobody read: this fails until both move together.
  const crmText = /WA_CONSENT_TEXT_ID =\s*'([^']+)'/.exec(crmConsent)?.[1];

  it('the dictionaries carry the same legal text as crm-service, in both locales', () => {
    expect(crmText).toBeTruthy();
    expect(waId.consent).toBe(crmText);
    expect(waEn.consent).toBe(crmText);
  });

  it('the text version is still the one the text was written for', () => {
    // Bump this together with WA_CONSENT_TEXT_VERSION when the words change.
    expect(/WA_CONSENT_TEXT_VERSION = '([^']+)'/.exec(crmConsent)?.[1]).toBe('2026-11-29');
  });

  it('id and en carry the same keys', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(waEn).sort()).toEqual(keys(waId).sort());
  });
});

describe('cashier QR drawing', () => {
  it('draws a square module grid for a wa.me link', async () => {
    const { size, d } = await qrPath('https://wa.me/628111?text=DAFTAR%20ABCD2345');
    expect(size).toBeGreaterThanOrEqual(21);
    // Every dark module is one `M<col> <row>h1v1h-1z`, inside the grid.
    const cells = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)];
    expect(cells.length).toBeGreaterThan(size);
    expect(cells.every(([, c, r]) => Number(c) < size && Number(r) < size)).toBe(true);
    // The three finder squares are always dark at their corners.
    expect(d).toContain('M0 0h1v1h-1z');
    expect(d).toContain(`M${size - 1} 0h1v1h-1z`);
    expect(d).toContain(`M0 ${size - 1}h1v1h-1z`);
  });
});
