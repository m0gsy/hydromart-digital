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
 * `total` is to be published beside the cells and exactly one cell was held back, that cell would
 * be total minus the others, so the smallest other non-empty cell is held back with it; if there is
 * none, the total itself is held back. ponytail: two or more held-back cells still leave their SUM
 * (2 to 4 people) derivable from a published total; tighten if an owner asks for it.
 */
export function suppressSmallGroups(cells: readonly GroupCell[], total?: number): MaskedGroups {
  const masked: MaskedCell[] = cells.map((c) =>
    c.people > 0 && c.people < SMALL_GROUP_MIN
      ? { key: c.key, value: null, flag: SMALL_GROUP_FLAG }
      : { key: c.key, value: c.people },
  );
  if (total === undefined) return { cells: masked, total: null };
  if (masked.filter((c) => c.flag).length !== 1) return { cells: masked, total };
  const next = masked
    .filter((c) => c.value !== null && c.value > 0)
    .sort((a, b) => (a.value as number) - (b.value as number))[0];
  if (!next) return { cells: masked, total: null, totalFlag: COMPLEMENT_FLAG };
  next.value = null;
  next.flag = COMPLEMENT_FLAG;
  return { cells: masked, total };
}

const PERSON_KEY =
  /^(phone|phonenumber|telepon|telp|hp|nohp|whatsapp|name|fullname|nama|namalengkap|customername|couriername|employeename|staffname|ownername|recipientname|email|address|alamat|street|jalan)$/i;
const PHONE_VALUE = /^\+?(62|0)8\d{7,12}$/;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The last gate before an answer leaves: refuses any field that is a person's phone, name,
 * address or email by its key, or whose text looks like a phone number or an email. A metric that
 * trips it is a bug to fix at its source, so this throws instead of quietly dropping the field.
 */
export function assertNoPersonalData(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    const text = value.replace(/[\s().-]/g, '');
    if (PHONE_VALUE.test(text) || EMAIL_VALUE.test(value.trim())) {
      throw new Error(`AI read answer carries a phone number or email at ${path}`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPersonalData(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (PERSON_KEY.test(k)) throw new Error(`AI read answer carries a personal field at ${path}.${k}`);
      assertNoPersonalData(v, `${path}.${k}`);
    }
  }
}
