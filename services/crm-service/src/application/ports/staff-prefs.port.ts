/**
 * Which staff have switched push off for one kind of depot alert.
 *
 * The switches ("Pesanan baru", "Stok menipis", ...) live on the staff settings screens and
 * are stored by admin-service. crm asks here before waking a phone, so the switch decides
 * what the phone buzzes for instead of only looking like it does.
 *
 * Implementations answer the accounts that are OFF. An account that never saved a preference
 * has the toggle's default (set by admin-service), so "unknown" is never reported as off. A
 * failure THROWS rather than answering "nobody": the caller decides what an unreadable answer
 * means, and for an alert that decision is "send to everyone".
 */
export interface StaffPrefsPort {
  pushDisabled(accountIds: string[], toggle: string): Promise<Set<string>>;
}
