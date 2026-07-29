import {
  AudienceEmployee,
  AudienceTarget,
  audienceMatches,
  isDueForPublish,
  resolveAudience,
  targetCovers,
} from '../../src/domain/announcement';
import type { AnnouncementDimension } from '../../prisma/generated/client';

const person = (over: Partial<AudienceEmployee> & { id: string }): AudienceEmployee => ({
  depotId: 'd1',
  departmentId: null,
  position: 'Driver',
  ...over,
});

const budi = person({ id: 'e1', depotId: 'd1', departmentId: 'gudang', position: 'Driver' });
const sari = person({ id: 'e2', depotId: 'd1', departmentId: 'finance', position: 'Kasir' });
const joko = person({ id: 'e3', depotId: 'd2', departmentId: 'gudang', position: 'driver' });

describe('announcement audience (C1)', () => {
  it('COMPANY covers everyone, value or not', () => {
    expect(targetCovers({ dimension: 'COMPANY', value: null }, budi)).toBe(true);
    expect(targetCovers({ dimension: 'COMPANY', value: 'ignored' }, joko)).toBe(true);
  });

  it('matches a depot, a department and a single employee on exact id', () => {
    expect(targetCovers({ dimension: 'DEPOT', value: 'd1' }, budi)).toBe(true);
    expect(targetCovers({ dimension: 'DEPOT', value: 'd1' }, joko)).toBe(false);
    expect(targetCovers({ dimension: 'DEPARTMENT', value: 'gudang' }, budi)).toBe(true);
    expect(targetCovers({ dimension: 'DEPARTMENT', value: 'gudang' }, sari)).toBe(false);
    expect(targetCovers({ dimension: 'EMPLOYEE', value: 'e2' }, sari)).toBe(true);
    expect(targetCovers({ dimension: 'EMPLOYEE', value: 'e2' }, budi)).toBe(false);
  });

  it('matches a position regardless of the case and spacing HR typed', () => {
    expect(targetCovers({ dimension: 'POSITION', value: ' driver ' }, budi)).toBe(true);
    expect(targetCovers({ dimension: 'POSITION', value: 'DRIVER' }, joko)).toBe(true);
    expect(targetCovers({ dimension: 'POSITION', value: 'Driver' }, sari)).toBe(false);
  });

  it('a target with no value covers NOBODY — an empty depot is a mistake, not everyone', () => {
    const dims: AnnouncementDimension[] = ['DEPOT', 'DEPARTMENT', 'POSITION', 'EMPLOYEE'];
    for (const dimension of dims) {
      expect(targetCovers({ dimension, value: null }, budi)).toBe(false);
      expect(targetCovers({ dimension, value: '' }, budi)).toBe(false);
    }
    // A department target never reaches someone with no department set.
    expect(targetCovers({ dimension: 'DEPARTMENT', value: 'gudang' }, person({ id: 'x' }))).toBe(
      false,
    );
  });

  it('rejects a dimension outside the enum rather than covering everyone', () => {
    expect(targetCovers({ dimension: 'GALAXY' as AnnouncementDimension, value: 'x' }, budi)).toBe(
      false,
    );
  });

  it('sends ONE copy when overlapping targets both cover the same person', () => {
    // Budi is in depot d1 AND department gudang. Joko is only in gudang.
    const targets: AudienceTarget[] = [
      { dimension: 'DEPOT', value: 'd1' },
      { dimension: 'DEPARTMENT', value: 'gudang' },
    ];
    const audience = resolveAudience(targets, [budi, sari, joko]);
    expect(audience.map((p) => p.id)).toEqual(['e1', 'e2', 'e3']);
    // The dedup is by identity, so a duplicated candidate row cannot double-send either.
    expect(resolveAudience(targets, [budi, budi, budi]).map((p) => p.id)).toEqual(['e1']);
  });

  it('reaches nobody when there are no targets at all', () => {
    expect(resolveAudience([], [budi, sari])).toEqual([]);
    expect(audienceMatches([], budi)).toBe(false);
  });

  it('keeps the candidate order it was given', () => {
    const targets: AudienceTarget[] = [{ dimension: 'COMPANY', value: null }];
    expect(resolveAudience(targets, [joko, budi, sari]).map((p) => p.id)).toEqual([
      'e3',
      'e1',
      'e2',
    ]);
  });
});

describe('scheduled release (C1)', () => {
  const now = new Date('2026-08-01T09:00:00.000Z');

  it('holds a future notice back until the sweep sees it come due', () => {
    const future = { scheduledAt: new Date('2026-08-01T10:00:00.000Z'), publishedAt: null };
    expect(isDueForPublish(future, now)).toBe(false);
    expect(isDueForPublish(future, new Date('2026-08-01T10:00:00.000Z'))).toBe(true);
  });

  it('never re-publishes something already out', () => {
    expect(
      isDueForPublish({ scheduledAt: new Date('2026-07-01T00:00:00.000Z'), publishedAt: now }, now),
    ).toBe(false);
  });

  it('leaves an unscheduled draft alone — the sweep is not a send-everything button', () => {
    expect(isDueForPublish({ scheduledAt: null, publishedAt: null }, now)).toBe(false);
  });
});
