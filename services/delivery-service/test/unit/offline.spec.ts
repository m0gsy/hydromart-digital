import { clampCapturedAt } from '../../src/domain/offline';
import { StaleCaptureError } from '../../src/domain/errors';

const NOW = new Date('2026-07-29T10:00:00.000Z');

describe('clampCapturedAt', () => {
  it('returns server time for live work (no capture time)', () => {
    expect(clampCapturedAt(undefined, NOW, 12)).toBe(NOW);
    expect(clampCapturedAt(null, NOW, 12)).toBe(NOW);
  });

  it('keeps a capture time that sits inside the window', () => {
    const captured = new Date('2026-07-29T09:30:00.000Z');
    expect(clampCapturedAt(captured, NOW, 12)).toEqual(captured);
  });

  it('caps a device clock running ahead at server time', () => {
    const future = new Date('2026-07-29T18:00:00.000Z');
    expect(clampCapturedAt(future, NOW, 12)).toEqual(NOW);
  });

  it('floors at the anchor so work cannot predate what it hangs off', () => {
    const captured = new Date('2026-07-29T06:00:00.000Z');
    const assignedAt = new Date('2026-07-29T09:00:00.000Z');
    expect(clampCapturedAt(captured, NOW, 12, assignedAt)).toEqual(assignedAt);
  });

  it('ignores a null anchor', () => {
    const captured = new Date('2026-07-29T09:00:00.000Z');
    expect(clampCapturedAt(captured, NOW, 12, null)).toEqual(captured);
  });

  it('refuses a capture older than the offline window', () => {
    const old = new Date('2026-07-28T20:00:00.000Z'); // 14 h back, window is 12 h
    expect(() => clampCapturedAt(old, NOW, 12)).toThrow(StaleCaptureError);
  });
});
