import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { StaffEmailDto } from '../../src/modules/dto/admin-notification-pref.dto';

// What the internal email route takes from crm, through the real decorators.
const body = {
  accountIds: ['3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807'],
  toggle: 'newFranchiseApp',
  subject: 'Lamaran waralaba baru: calon mitra di Bekasi, Jawa Barat',
  text: 'Lamaran waralaba baru dari calon mitra di Bekasi, Jawa Barat.',
  path: '/hq/applications/detail?id=3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807',
};
const refused = (over: Record<string, unknown>) =>
  validateSync(plainToInstance(StaffEmailDto, { ...body, ...over })).map((e) => e.property);

describe('StaffEmailDto', () => {
  it("takes crm's email, the longest franchise subject included", () => {
    expect(refused({})).toEqual([]);
    const place = 'x'.repeat(100);
    expect(refused({ subject: `Lamaran waralaba baru: calon mitra di ${place}, ${place}` })).toEqual([]);
  });

  it('takes only a path on the web app as the link', () => {
    expect(refused({ path: 'https://elsewhere.example/x' })).toEqual(['path']);
    expect(refused({ path: '/hq/applications detail' })).toEqual(['path']);
    expect(refused({ path: `/hq/${String.fromCharCode(10)}x` })).toEqual(['path']);
  });

  it('refuses an unknown switch, a blank subject or body, and a subject past 300 characters', () => {
    expect(refused({ toggle: 'nonsense' })).toEqual(['toggle']);
    expect(refused({ subject: '', text: '' })).toEqual(['subject', 'text']);
    expect(refused({ subject: 'x'.repeat(301) })).toEqual(['subject']);
    expect(refused({ accountIds: ['not-an-id'] })).toEqual(['accountIds']);
  });
});
