import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SETTING_DEFS } from '../../src/config/setting-defs';
import { PutSettingDto } from '../../src/modules/dto/settings.dto';

/**
 * CA-1-41 — the PPh 21 TER table could not be saved through the screen built to edit it.
 *
 * `PutSettingDto.value` carried `@MaxLength(128)`. `pph21TerTableJson` is the PMK 168/2023
 * withholding table — 125 bands across three categories, 4.2 KB minified — so every attempt
 * to set it was refused by validation before it reached the service.
 *
 * That is not a cosmetic limit. The table decides how much tax comes off a payslip. It could
 * be loaded from `HR_PPH21_TER_TABLE_JSON` at boot and never through the console, which
 * means changing a national tax table meant a deploy, and the screen offering to do it was
 * lying.
 *
 * The reference file is the fixture on purpose: a length that happens to pass a made-up
 * string proves nothing about the document this setting actually has to hold.
 */

const TER_JSON = JSON.stringify(
  JSON.parse(
    readFileSync(join(__dirname, '../../reference/pph21-ter-pmk-168-2023.json'), 'utf8'),
  ),
);

const validateValue = async (value: string) =>
  validate(plainToInstance(PutSettingDto, { key: 'pph21TerTableJson', scope: 'GLOBAL', value }));

describe('CA-1-41 the TER table fits through the door built for it', () => {
  it('accepts the real PMK 168/2023 table', async () => {
    // Guard the guard: if the file ever shrinks under 128 bytes this test stops meaning
    // anything, and it would go on passing.
    expect(TER_JSON.length).toBeGreaterThan(4000);
    await expect(validateValue(TER_JSON)).resolves.toEqual([]);
  });

  it('still refuses a value no setting could justify', async () => {
    // 16 KB is a ceiling, not an absence of one — a settings row stays a setting.
    const errors = await validateValue('x'.repeat(16_385));
    expect(errors).not.toEqual([]);
    expect(JSON.stringify(errors)).toContain('maxLength');
  });

  it('marks the table as long-form on the DEF, not by key name in the console', async () => {
    const def = SETTING_DEFS.find((d) => d.key === 'pph21TerTableJson');
    // The console renders a textarea from this flag. A hardcoded list of key names there
    // would drift the first time a second document-shaped setting is added.
    expect(def?.long).toBe(true);
    // And nothing else claims to be a document.
    expect(SETTING_DEFS.filter((d) => d.long).map((d) => d.key)).toEqual(['pph21TerTableJson']);
  });
});
