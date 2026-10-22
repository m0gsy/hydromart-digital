/**
 * Custom roles are `C_` + a slug (see @hydromart/access). The slug is all a screen has when it
 * only holds an account's role string, so the label is made from it; the matrix screen, which
 * has the real names, shows those instead.
 */
export function isCustomRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.startsWith('C_');
}

/** `C_kasir_depot` -> `Kasir depot`. */
export function customRoleLabel(key: string): string {
  const words = key.replace(/^C_/, '').replace(/_+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** A built-in role goes through the dictionary; a custom one is labelled from its key. */
export function roleLabel(t: (key: string) => string, role: string, namespace = 'hq.roles'): string {
  return isCustomRole(role) ? customRoleLabel(role) : t(`${namespace}.${role}`);
}
