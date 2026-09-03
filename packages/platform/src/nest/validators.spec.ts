import { validateSync } from 'class-validator';

import { IsNotBefore } from './date-range.validator';
import { IsWithinDays, MAX_RANGE_DAYS } from './date-range-span.validator';
import { IsIanaTimezone } from './timezone.validator';
import { IsPublicHttpsUrl } from './public-url.validator';

class Range {
  from?: string;
  @IsNotBefore('from')
  to?: string;
}

class Span {
  from?: string;
  @IsWithinDays('from')
  to?: string;
}

class ShortSpan {
  start?: string;
  @IsWithinDays('start', 7)
  end?: string;
}

class Settings {
  @IsIanaTimezone()
  tz!: string;
}

class Hook {
  @IsPublicHttpsUrl()
  url!: string;
}

function errorsFor<T extends object>(Ctor: new () => T, patch: Partial<T>): string[] {
  const dto = Object.assign(new Ctor(), patch);
  return validateSync(dto).flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('IsNotBefore', () => {
  it('rejects a reversed range', () => {
    expect(errorsFor(Range, { from: '2026-07-31', to: '2026-07-01' })).toContain('isNotBefore');
  });

  it('accepts a forward range and an equal pair', () => {
    expect(errorsFor(Range, { from: '2026-07-01', to: '2026-07-31' })).toEqual([]);
    expect(errorsFor(Range, { from: '2026-07-01', to: '2026-07-01' })).toEqual([]);
  });

  it('stays silent when a bound is absent or unparseable (other decorators own that)', () => {
    expect(errorsFor(Range, { to: '2026-07-01' })).toEqual([]);
    expect(errorsFor(Range, { from: 'not-a-date', to: '2026-07-01' })).toEqual([]);
  });
});

describe('IsWithinDays', () => {
  it('rejects a window wider than the default year', () => {
    expect(errorsFor(Span, { from: '2020-01-01', to: '2026-01-01' })).toContain('isWithinDays');
  });

  it('accepts a window exactly at the cap', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date(from.getTime() + MAX_RANGE_DAYS * 24 * 60 * 60 * 1000);
    expect(errorsFor(Span, { from: from.toISOString(), to: to.toISOString() })).toEqual([]);
  });

  it('honours a per-endpoint cap', () => {
    expect(errorsFor(ShortSpan, { start: '2026-07-01', end: '2026-07-05' })).toEqual([]);
    expect(errorsFor(ShortSpan, { start: '2026-07-01', end: '2026-07-30' })).toContain(
      'isWithinDays',
    );
  });

  it('stays silent when a bound is absent or unparseable (other decorators own that)', () => {
    expect(errorsFor(Span, { to: '2026-07-01' })).toEqual([]);
    expect(errorsFor(Span, { from: 'not-a-date', to: '2026-07-01' })).toEqual([]);
  });
});

describe('IsIanaTimezone', () => {
  it('accepts real zone ids', () => {
    for (const tz of ['Asia/Jakarta', 'Asia/Makassar', 'Europe/London', 'UTC']) {
      expect(errorsFor(Settings, { tz })).toEqual([]);
    }
  });

  it('rejects local shorthand and offsets', () => {
    for (const tz of ['WIB', 'WITA', 'GMT+7', 'UTC+7', '', 'Asia/Nowhere']) {
      expect(errorsFor(Settings, { tz })).toContain('isIanaTimezone');
    }
  });
});

describe('IsPublicHttpsUrl', () => {
  it('accepts an absolute https URL on a public host', () => {
    expect(errorsFor(Hook, { url: 'https://partner.example.com/hooks' })).toEqual([]);
  });

  it('rejects schemeless, plain http, and bare hosts', () => {
    for (const url of [
      'partner.example.com/hooks',
      'http://partner.example.com',
      'https://partner',
    ]) {
      expect(errorsFor(Hook, { url })).toContain('isPublicHttpsUrl');
    }
  });

  it('rejects loopback, RFC-1918 and cloud-metadata hosts (SSRF)', () => {
    for (const url of [
      'https://localhost/hooks',
      'https://127.0.0.1/hooks',
      'https://10.0.0.5/hooks',
      'https://172.16.4.2/hooks',
      'https://192.168.1.10/hooks',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/hooks',
    ]) {
      expect(errorsFor(Hook, { url })).toContain('isPublicHttpsUrl');
    }
  });
});
