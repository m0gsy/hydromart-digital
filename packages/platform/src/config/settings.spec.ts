import { coerce, resolveRaw, SettingsCache, SettingRow, SettingsSource } from './settings';

describe('coerce', () => {
  it('truncates int and money, keeps number, passes string', () => {
    expect(coerce('8', 'int')).toBe(8);
    expect(coerce('12000', 'money')).toBe(12000);
    expect(coerce('18.5', 'number')).toBe(18.5);
    expect(coerce('18.9', 'int')).toBe(18);
    expect(coerce('Asia/Jakarta', 'string')).toBe('Asia/Jakarta');
  });
});

describe('resolveRaw', () => {
  const rows: SettingRow[] = [
    { scope: 'GLOBAL', depotId: null, key: 'shiftLengthHours', value: '8' },
    { scope: 'DEPOT', depotId: 'd1', key: 'shiftLengthHours', value: '6' },
  ];
  it('prefers depot override over global', () => {
    expect(resolveRaw('shiftLengthHours', 'd1', rows)).toBe('6');
  });
  it('falls back to global when depot has no override', () => {
    expect(resolveRaw('shiftLengthHours', 'd2', rows)).toBe('8');
  });
  it('returns null when neither exists', () => {
    expect(resolveRaw('unknownKey', 'd1', rows)).toBeNull();
  });
});

describe('SettingsCache.effective', () => {
  const source: SettingsSource = {
    loadAll: async () => [
      { scope: 'GLOBAL', depotId: null, key: 'fee', value: '2000' },
      { scope: 'DEPOT', depotId: 'd1', key: 'fee', value: '1000' },
    ],
  };
  it('coerces depot override, then global, then env default', async () => {
    const cache = new SettingsCache(source);
    await cache.refresh();
    expect(cache.effective('fee', 'money', 5000, 'd1')).toBe(1000);
    expect(cache.effective('fee', 'money', 5000, 'd2')).toBe(2000);
    expect(cache.effective('missing', 'money', 5000, 'd1')).toBe(5000);
  });
  it('returns env default before first refresh', () => {
    const cache = new SettingsCache(source);
    expect(cache.effective('fee', 'money', 5000, 'd1')).toBe(5000);
  });
});
