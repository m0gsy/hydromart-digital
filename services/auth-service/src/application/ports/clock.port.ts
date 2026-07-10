/** Abstraction over the current time, so time-dependent logic is deterministic in tests. */
export interface ClockPort {
  now(): Date;
}
