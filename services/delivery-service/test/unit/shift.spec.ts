import {
  ShiftStatus,
  acceptsAssignments,
  breakOverageSeconds,
  breakSecondsElapsed,
  breakSecondsRemaining,
  canTransition,
  expectedEndAt,
  isAtDepot,
  isOpen,
} from '../../src/domain/shift';

// The depot the designs use (Bandung).
const DEPOT = { lat: -6.9147, lng: 107.6098 };

describe('shift domain', () => {
  describe('transitions', () => {
    it('lets a courier pause and resume without a fresh check-in', () => {
      expect(canTransition(ShiftStatus.ONLINE, ShiftStatus.BREAK)).toBe(true);
      expect(canTransition(ShiftStatus.BREAK, ShiftStatus.ONLINE)).toBe(true);
      expect(canTransition(ShiftStatus.OFFLINE, ShiftStatus.ONLINE)).toBe(true);
    });

    it('makes ENDED terminal — a checked-out shift never reopens', () => {
      expect(isOpen(ShiftStatus.ENDED)).toBe(false);
      for (const to of Object.values(ShiftStatus)) {
        expect(canTransition(ShiftStatus.ENDED, to)).toBe(false);
      }
    });

    it('treats ONLINE/BREAK/OFFLINE as open', () => {
      expect(isOpen(ShiftStatus.ONLINE)).toBe(true);
      expect(isOpen(ShiftStatus.BREAK)).toBe(true);
      expect(isOpen(ShiftStatus.OFFLINE)).toBe(true);
    });
  });

  describe('acceptsAssignments', () => {
    it('hands work only to an ONLINE courier', () => {
      expect(acceptsAssignments(ShiftStatus.ONLINE)).toBe(true);
      expect(acceptsAssignments(ShiftStatus.BREAK)).toBe(false);
      expect(acceptsAssignments(ShiftStatus.OFFLINE)).toBe(false);
      expect(acceptsAssignments(ShiftStatus.ENDED)).toBe(false);
    });
  });

  describe('isAtDepot', () => {
    it('accepts a courier standing at the depot', () => {
      expect(isAtDepot(DEPOT, DEPOT, 200)).toBe(true);
    });

    it('accepts just inside and rejects just outside the radius', () => {
      // ~0.0009° of latitude ≈ 100 m; ~0.0027° ≈ 300 m.
      expect(isAtDepot({ lat: DEPOT.lat + 0.0009, lng: DEPOT.lng }, DEPOT, 200)).toBe(true);
      expect(isAtDepot({ lat: DEPOT.lat + 0.0027, lng: DEPOT.lng }, DEPOT, 200)).toBe(false);
    });

    it('rejects a courier in another city', () => {
      expect(isAtDepot({ lat: -6.2088, lng: 106.8456 }, DEPOT, 200)).toBe(false);
    });
  });

  describe('breakSecondsElapsed', () => {
    it('is zero when no break is running', () => {
      expect(breakSecondsElapsed(null, new Date())).toBe(0);
    });

    it('counts whole seconds since the break started', () => {
      const start = new Date('2026-07-17T12:00:00.000Z');
      const now = new Date('2026-07-17T12:05:30.000Z');
      expect(breakSecondsElapsed(start, now)).toBe(330);
    });

    it('never credits time back when the clock runs backwards', () => {
      const start = new Date('2026-07-17T12:05:00.000Z');
      const now = new Date('2026-07-17T12:00:00.000Z');
      expect(breakSecondsElapsed(start, now)).toBe(0);
    });
  });

  describe('break quota', () => {
    it('reports the remaining allowance, floored at zero', () => {
      expect(breakSecondsRemaining(0, 30)).toBe(1800);
      expect(breakSecondsRemaining(600, 30)).toBe(1200);
      expect(breakSecondsRemaining(2400, 30)).toBe(0);
    });

    it('records overage past quota instead of blocking', () => {
      expect(breakOverageSeconds(1200, 30)).toBe(0);
      expect(breakOverageSeconds(1800, 30)).toBe(0);
      expect(breakOverageSeconds(2400, 30)).toBe(600);
    });
  });

  describe('expectedEndAt', () => {
    it('freezes the shift end at check-in', () => {
      const checkIn = new Date('2026-07-17T06:00:00.000Z');
      expect(expectedEndAt(checkIn, 8).toISOString()).toBe('2026-07-17T14:00:00.000Z');
    });
  });
});
