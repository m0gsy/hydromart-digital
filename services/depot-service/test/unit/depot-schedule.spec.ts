import { MAX_HOLIDAYS, parseHolidays, parseOperatingHours } from '../../src/domain/depot-schedule';

const hours = (input: unknown) => {
  const r = parseOperatingHours(input);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
};
const hoursErr = (input: unknown): string => {
  const r = parseOperatingHours(input);
  if (r.ok) throw new Error('expected an error');
  return r.error;
};
const holidays = (input: unknown) => {
  const r = parseHolidays(input);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
};
const holidaysErr = (input: unknown): string => {
  const r = parseHolidays(input);
  if (r.ok) throw new Error('expected an error');
  return r.error;
};

describe('parseOperatingHours', () => {
  it('treats absent and null as no hours configured', () => {
    expect(hours(undefined)).toEqual({});
    expect(hours(null)).toEqual({});
    expect(hours({})).toEqual({});
  });

  it('keeps a plain day and a day with a break', () => {
    expect(
      hours({
        mon: { open: '08:00', close: '20:00' },
        tue: { open: '08:00', close: '20:00', breakStart: '12:00', breakEnd: '13:00' },
      }),
    ).toEqual({
      mon: { open: '08:00', close: '20:00' },
      tue: { open: '08:00', close: '20:00', breakStart: '12:00', breakEnd: '13:00' },
    });
  });

  it('reads a day with every cell blank as closed, and blank breaks as no break', () => {
    expect(
      hours({
        mon: { open: '', close: '', breakStart: '', breakEnd: '' },
        tue: null,
        wed: { open: '08:00', close: '17:00', breakStart: '', breakEnd: '' },
      }),
    ).toEqual({ wed: { open: '08:00', close: '17:00' } });
  });

  it('accepts the day boundaries 00:00 and 23:59', () => {
    expect(hours({ sun: { open: '00:00', close: '23:59' } })).toEqual({
      sun: { open: '00:00', close: '23:59' },
    });
  });

  it.each([
    ['an array', [], 'objek per hari'],
    ['a string', 'x', 'objek per hari'],
    ['an unknown day', { monday: { open: '08:00', close: '17:00' } }, 'hari "monday"'],
    ['a day that is not an object', { mon: 'open' }, 'mon: harus berupa objek'],
    ['an unknown cell', { mon: { open: '08:00', close: '17:00', lunch: '1' } }, 'kolom "lunch"'],
    ['open without close', { mon: { open: '08:00' } }, 'diisi bersama'],
    ['close without open', { mon: { close: '17:00' } }, 'diisi bersama'],
    ['24:00', { mon: { open: '08:00', close: '24:00' } }, 'bukan jam HH:MM'],
    ['8:00 without the zero', { mon: { open: '8:00', close: '17:00' } }, 'bukan jam HH:MM'],
    ['a minute of 60', { mon: { open: '08:60', close: '17:00' } }, 'bukan jam HH:MM'],
    ['a number', { mon: { open: 800, close: '17:00' } }, 'bukan jam HH:MM'],
    ['close equal to open', { mon: { open: '08:00', close: '08:00' } }, 'setelah jam buka'],
    ['close before open', { mon: { open: '20:00', close: '08:00' } }, 'setelah jam buka'],
    [
      'a break start alone',
      { mon: { open: '08:00', close: '17:00', breakStart: '12:00' } },
      'istirahat harus diisi bersama',
    ],
    [
      'a bad break time',
      { mon: { open: '08:00', close: '17:00', breakStart: '12:00', breakEnd: '1pm' } },
      'selesai istirahat "1pm"',
    ],
    [
      'a break that ends before it starts',
      { mon: { open: '08:00', close: '17:00', breakStart: '13:00', breakEnd: '12:00' } },
      'setelah mulai istirahat',
    ],
    [
      'a break before opening',
      { mon: { open: '08:00', close: '17:00', breakStart: '07:00', breakEnd: '09:00' } },
      'di dalam jam buka',
    ],
    [
      'a break after closing',
      { mon: { open: '08:00', close: '17:00', breakStart: '16:00', breakEnd: '18:00' } },
      'di dalam jam buka',
    ],
  ])('rejects %s', (_n, input, msg) => {
    expect(hoursErr(input)).toContain(msg);
  });
});

describe('parseHolidays', () => {
  it('treats absent as none and sorts by date', () => {
    expect(holidays(undefined)).toEqual([]);
    expect(holidays(null)).toEqual([]);
    expect(
      holidays([{ date: '2026-12-25' }, { date: '2026-08-17', label: ' Kemerdekaan ' }]),
    ).toEqual([{ date: '2026-08-17', label: 'Kemerdekaan' }, { date: '2026-12-25' }]);
  });

  it('drops a blank label', () => {
    expect(
      holidays([
        { date: '2026-08-17', label: '  ' },
        { date: '2026-08-18', label: '' },
      ]),
    ).toEqual([{ date: '2026-08-17' }, { date: '2026-08-18' }]);
  });

  it('accepts 29 February only in a leap year', () => {
    expect(holidays([{ date: '2028-02-29' }])).toEqual([{ date: '2028-02-29' }]);
    expect(holidaysErr([{ date: '2026-02-29' }])).toContain('bukan tanggal');
  });

  it.each([
    ['not a list', {}, 'berupa daftar'],
    ['an item that is not an object', ['2026-08-17'], '{ date, label }'],
    ['an array item', [[]], '{ date, label }'],
    ['an unknown field', [{ date: '2026-08-17', note: 'x' }], 'kolom "note"'],
    ['a missing date', [{ label: 'x' }], 'bukan tanggal'],
    ['a slash date', [{ date: '17/08/2026' }], 'bukan tanggal'],
    ['month 13', [{ date: '2026-13-01' }], 'bukan tanggal'],
    ['30 February', [{ date: '2026-02-30' }], 'bukan tanggal'],
    ['a numeric date (an Excel serial)', [{ date: 46251 }], 'bukan tanggal'],
    ['a repeated date', [{ date: '2026-08-17' }, { date: '2026-08-17' }], 'lebih dari sekali'],
    ['a non-text label', [{ date: '2026-08-17', label: 5 }], 'harus teks'],
    ['a long label', [{ date: '2026-08-17', label: 'x'.repeat(101) }], 'maksimal 100'],
  ])('rejects %s', (_n, input, msg) => {
    expect(holidaysErr(input)).toContain(msg);
  });

  it('caps the number of dates', () => {
    const many = Array.from({ length: MAX_HOLIDAYS + 1 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    }));
    expect(holidaysErr(many)).toContain(`maksimal ${MAX_HOLIDAYS}`);
    expect(holidays(many.slice(0, MAX_HOLIDAYS))).toHaveLength(MAX_HOLIDAYS);
  });
});
