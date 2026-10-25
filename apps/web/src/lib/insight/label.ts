import { shortMonths } from '@/lib/format';

/**
 * A period label as a reader says it. The API names a bucket by its date ("2026-10-22", a month
 * "2026-10") and a week by its Monday; the axis shows "22 Okt" and "Okt 2026". Anything that is
 * not a date (the forecast's "-3", "+1") is returned untouched.
 */
export function periodLabel(raw: string, locale: string): string {
  const months = shortMonths(locale);
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (day) {
    const m = months[Number(day[2]) - 1];
    return m ? `${Number(day[3])} ${m}` : raw;
  }
  const month = /^(\d{4})-(\d{2})$/.exec(raw);
  if (month) {
    const m = months[Number(month[2]) - 1];
    return m ? `${m} ${month[1]}` : raw;
  }
  return raw;
}
