'use client';

import { useState, type ChangeEvent } from 'react';

import { todayWib } from './wib';

/**
 * The earliest day a picker accepts. Typing a year into a date field passes through 0002, 0020
 * and 0202 on the way to 2026, and before 1924 the business zone had no whole-minute offset
 * (`dayStartWib` throws there): a partial value like that must never become the day.
 */
export const MIN_DAY = '2020-01-01';

const isPickable = (v: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= MIN_DAY && v <= todayWib();

/**
 * One business (WIB) day chosen on a screen (flow 8c: payment reconciliation, cash book).
 *
 * Until another day is picked it is TODAY, and today moves at WIB midnight by itself: a console
 * left open overnight reads the new day when it comes back, as these screens did before they
 * had a picker. `current()` answers at call time, for a loader `useAsync` re-runs on resume.
 */
export function useWibDay(
  /**
   * False for a page that EDITS the day it shows (the meter form): it stays on the day it
   * opened on, so a value typed before WIB midnight and saved after it goes to that day,
   * not to a new day the reader never saw. True (the default) for read screens.
   */
  rollOver = true,
) {
  const [picked, setPicked] = useState<string | null>(() => (rollOver ? null : todayWib()));
  // What the field shows while a date is being typed; only a whole, sane date becomes the day.
  const [draft, setDraft] = useState<string | null>(null);
  const today = todayWib();
  const day = picked ?? today;
  return {
    day,
    isToday: day === today,
    current: (): string => picked ?? todayWib(),
    /** Back to today (rolling), e.g. after recording something that is dated now. */
    reset: (): void => {
      setPicked(rollOver ? null : todayWib());
      setDraft(null);
    },
    /** Spread onto an `<Input type="date">`. */
    inputProps: {
      type: 'date',
      value: draft ?? day,
      min: MIN_DAY,
      max: today,
      onChange: (e: ChangeEvent<HTMLInputElement>): void => {
        const v = e.target.value;
        setDraft(v);
        if (isPickable(v)) setPicked(v === todayWib() && rollOver ? null : v);
      },
      onBlur: (): void => setDraft(null),
    },
  };
}
