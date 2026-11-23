import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SOURCE_CODE_PATTERN } from '@/lib/attribution';
import { privacy as privacyEn } from '@/lib/dictionaries/en/privacy';
import { terms as termsEn } from '@/lib/dictionaries/en/terms';
import { privacy as privacyId } from '@/lib/dictionaries/id/privacy';
import { terms as termsId } from '@/lib/dictionaries/id/terms';

const repo = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

const AUTH_CONSENT = 'services/auth-service/src/application/services/consent.service.ts';
const AUTH_SIGNUP_DTO = 'services/auth-service/src/modules/auth/dto/register.dto.ts';
const DEPOT_FRANCHISE = 'services/depot-service/src/domain/franchise-application.ts';

const MONTHS = {
  id: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

/** "Berlaku sejak 23 November 2026" to "2026-11-23". */
function isoDate(line: string, lang: keyof typeof MONTHS): string {
  const [, day, name, year] = /(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(line) ?? [];
  const month = name ? MONTHS[lang].indexOf(name) + 1 : 0;
  if (!day || !year || month === 0) throw new Error(`no date at the end of "${line}"`);
  return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function constant(file: string, name: string): string {
  const [, value] = new RegExp(`export const ${name} = ([^;]+);`).exec(read(file)) ?? [];
  if (!value) throw new Error(`${name} not found in ${file}`);
  return value.trim();
}

const privacyDate = isoDate(privacyId.effective, 'id');
const termsDate = isoDate(termsId.effective, 'id');

/**
 * A consent row names the text it agreed to by the date that text took effect. When the text
 * moves and the stored version does not, the record claims agreement to words nobody was shown:
 * the ledger read '1.0' until 29 Aug 2026, and the Terms moved to 14 Oct 2026 without it.
 */
describe('the versions a consent is recorded against (HD-8)', () => {
  it('names the same date in both languages', () => {
    expect(isoDate(privacyEn.effective, 'en')).toBe(privacyDate);
    expect(isoDate(termsEn.effective, 'en')).toBe(termsDate);
  });

  it('records a signup against the later of the Terms and the Privacy Policy', () => {
    const latest = [privacyDate, termsDate].sort().at(-1);
    expect(constant(AUTH_CONSENT, 'CONSENT_DOCUMENT_VERSION')).toBe(`'${latest}'`);
  });

  it('records a /waralaba application against the Privacy Policy its box links', () => {
    expect(constant(DEPOT_FRANCHISE, 'PRIVACY_POLICY_VERSION')).toBe(`'${privacyDate}'`);
  });
});

describe('the campaign code shape (HD-8)', () => {
  // The web stores only codes of this shape and both services refuse any other, so a copy that
  // drifted would turn a stored code into a refused signup or a refused application.
  it('is one pattern in the web, auth-service and depot-service', () => {
    const web = `/${SOURCE_CODE_PATTERN.source}/`;
    expect(constant(AUTH_SIGNUP_DTO, 'SOURCE_CODE_PATTERN')).toBe(web);
    expect(constant(DEPOT_FRANCHISE, 'SOURCE_CODE_PATTERN')).toBe(web);
  });
});
