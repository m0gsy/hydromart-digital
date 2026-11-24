/**
 * HD-6, owner decision 24 Nov 2026: no phone, name or address ever leaves the AI read API.
 * Customers and couriers appear as counts or opaque ids only, and a group of fewer than 3 people
 * is not answered with its number.
 */

/** A group smaller than this is held back. */
export const SMALL_GROUP_MIN = 3;
export const SMALL_GROUP_FLAG = 'kurang dari 3';
/** A cell held back only so a published total cannot give a small cell away by subtraction. */
export const COMPLEMENT_FLAG = 'ditahan';

export interface GroupCell {
  key: string;
  /** People in the group (customers, couriers): a count of heads, never an amount. */
  people: number;
}

export interface MaskedCell {
  key: string;
  /** Null when held back; see `flag`. */
  value: number | null;
  flag?: typeof SMALL_GROUP_FLAG | typeof COMPLEMENT_FLAG;
}

export interface MaskedGroups {
  cells: MaskedCell[];
  /** The total as it may be published: null when publishing it would give a held-back cell away. */
  total: number | null;
  totalFlag?: typeof COMPLEMENT_FLAG;
}

/**
 * Hold back every group of 1 or 2 people (an empty group names nobody, so it stays). When a
 * `total` is published beside the cells, held-back cells would be derivable by subtraction, so the
 * smallest other non-empty cells are held back too until the held-back people add up to at least
 * 2 x SMALL_GROUP_MIN (no held cell can then be pinned to fewer than 3 people); if the cells run
 * out first, the total itself is held back.
 *
 * Differencing ACROSS answers is the metric author's to prevent: never publish two overlapping
 * windows (a month and a month-minus-one-day, or a depot list and the same list minus one depot)
 * of the same people-count, because their difference is a smaller group than either shows.
 */
export function suppressSmallGroups(cells: readonly GroupCell[], total?: number): MaskedGroups {
  const masked: MaskedCell[] = cells.map((c) =>
    c.people > 0 && c.people < SMALL_GROUP_MIN
      ? { key: c.key, value: null, flag: SMALL_GROUP_FLAG }
      : { key: c.key, value: c.people },
  );
  if (total === undefined) return { cells: masked, total: null };
  let held = cells.reduce((sum, c, i) => sum + (masked[i].flag ? c.people : 0), 0);
  if (held === 0) return { cells: masked, total };
  const rest = masked
    .map((m, i) => ({ m, people: cells[i].people }))
    .filter((x) => !x.m.flag && x.people > 0)
    .sort((a, b) => a.people - b.people);
  for (const x of rest) {
    if (held >= 2 * SMALL_GROUP_MIN) break;
    x.m.value = null;
    x.m.flag = COMPLEMENT_FLAG;
    held += x.people;
  }
  if (held < 2 * SMALL_GROUP_MIN) return { cells: masked, total: null, totalFlag: COMPLEMENT_FLAG };
  return { cells: masked, total };
}

/** Matched after lower-casing and dropping `_`, `-` and spaces, so `Phone_Number` and `no-hp` are one key. */
const PERSON_KEYS = new Set([
  'phone',
  'phonenumber',
  'hp',
  'nohp',
  'telepon',
  'telp',
  'whatsapp',
  'email',
  'name',
  'nama',
  'namalengkap',
  'fullname',
  'firstname',
  'lastname',
  'customername',
  'couriername',
  'employeename',
  'staffname',
  'ownername',
  'recipientname',
  'address',
  'alamat',
  'street',
  'jalan',
]);
const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const NUMBER_RUN = /(?<![\w-])\+?\d[\d\s.()-]{8,18}\d(?![\w-])/g;

export class PersonalDataError extends Error {
  constructor(readonly rule: 'key' | 'phone' | 'email') {
    super('personal data in an AI read answer');
  }
}

/** A phone number: 10 to 13 digits starting 08, 62 or 8, standing alone in the text (not inside an id). */
function hasPhone(text: string): boolean {
  return (text.match(NUMBER_RUN) ?? []).some((run) => {
    const digits = run.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 13 && /^(08|62|8)/.test(digits);
  });
}

function checkText(text: string): void {
  if (EMAIL_IN_TEXT.test(text)) throw new PersonalDataError('email');
  if (hasPhone(text)) throw new PersonalDataError('phone');
}

/**
 * The last gate before an answer leaves: refuses a field that is a person's phone, name, address
 * or email by its key (normalised), and any key or string value that contains an email or a phone
 * number. A display name travels only under `label`, which this does not refuse by key (its text
 * is still scanned). A metric that trips it is a bug to fix at its source, so this throws a
 * PersonalDataError that carries the RULE, never the offending key, path or value.
 */
export function assertNoPersonalData(value: unknown): void {
  if (typeof value === 'string') {
    checkText(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => assertNoPersonalData(v));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (PERSON_KEYS.has(k.toLowerCase().replace(/[_\-\s]/g, ''))) throw new PersonalDataError('key');
      // A map keyed by what it counts (`{"0812...": 3}`) puts data in the key.
      checkText(k);
      assertNoPersonalData(v);
    }
  }
}
