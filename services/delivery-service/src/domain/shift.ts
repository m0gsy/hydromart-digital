/**
 * Courier shift rules (design 3a check-in, 3b availability). Framework-free.
 *
 * A shift is the unit every end-of-shift COD settlement is computed over, and the
 * gate on receiving assignments — so its state machine is the app's front door.
 */
import { haversineMeters } from './geo';

export enum ShiftStatus {
  ONLINE = 'ONLINE',
  BREAK = 'BREAK',
  OFFLINE = 'OFFLINE',
  ENDED = 'ENDED',
}

const TRANSITIONS: Record<ShiftStatus, readonly ShiftStatus[]> = {
  // OFFLINE is "stop taking new work", not "gone" — a courier can come back ONLINE
  // without a fresh check-in. Only check-out ENDs a shift.
  [ShiftStatus.ONLINE]: [ShiftStatus.BREAK, ShiftStatus.OFFLINE, ShiftStatus.ENDED],
  [ShiftStatus.BREAK]: [ShiftStatus.ONLINE, ShiftStatus.OFFLINE, ShiftStatus.ENDED],
  [ShiftStatus.OFFLINE]: [ShiftStatus.ONLINE, ShiftStatus.ENDED],
  [ShiftStatus.ENDED]: [],
};

export function canTransition(from: ShiftStatus, to: ShiftStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A shift is open until check-out; only an open shift can change status. */
export function isOpen(status: ShiftStatus): boolean {
  return status !== ShiftStatus.ENDED;
}

/** Only an ONLINE courier is handed new deliveries (design 3b). */
export function acceptsAssignments(status: ShiftStatus): boolean {
  return status === ShiftStatus.ONLINE;
}

/** Whether the courier is standing at the depot, within the allowed check-in radius. */
export function isAtDepot(
  courier: { lat: number; lng: number },
  depot: { lat: number; lng: number },
  radiusMeters: number,
): boolean {
  return haversineMeters(courier.lat, courier.lng, depot.lat, depot.lng) <= radiusMeters;
}

/**
 * Break seconds consumed once the courier leaves BREAK. Returns 0 when they were
 * not on a break, and never goes negative (a clock skew must not credit time back).
 */
export function breakSecondsElapsed(breakStartedAt: Date | null, now: Date): number {
  if (!breakStartedAt) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - breakStartedAt.getTime()) / 1000));
}

/**
 * Break time used beyond quota, in seconds. Exceeding quota is *recorded*, never
 * blocked: refusing to let a courier come back ONLINE would be a worse failure than
 * the overage it prevents. The overage becomes a payout DEDUCTION (slice 10).
 */
export function breakOverageSeconds(breakSecondsUsed: number, quotaMinutes: number): number {
  return Math.max(0, breakSecondsUsed - quotaMinutes * 60);
}

/** Remaining break allowance in seconds, floored at 0 (design 3b countdown). */
export function breakSecondsRemaining(breakSecondsUsed: number, quotaMinutes: number): number {
  return Math.max(0, quotaMinutes * 60 - breakSecondsUsed);
}

/** Shift end frozen at check-in, so a config change cannot move a running shift. */
export function expectedEndAt(checkInAt: Date, shiftLengthHours: number): Date {
  return new Date(checkInAt.getTime() + shiftLengthHours * 3_600_000);
}
