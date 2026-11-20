/**
 * Flow 6a: the switches a notification's destination waits on (owner decision 2026-11-19).
 *
 * A destination the installed app cannot open is worse than none: the tap lands on a blank
 * screen. Such a destination is held behind a brake in admin-service's flags, and this answers
 * whether it is released. Implementations NEVER throw and answer false whenever they cannot
 * tell: the brake is read fail-closed, the inbox being the safe place to land.
 */
export interface DestinationBrakesPort {
  /** `/hr/leave` for LEAVE_SUBMITTED (flag `notifications.leave_screen`). */
  leaveScreenLive(): Promise<boolean>;
}
