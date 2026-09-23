/**
 * PYO-3/PYO-7 — what a payout destination looks like to anyone who is not paying it.
 *
 * `withdrawals.bankAccountRef` is documented as "Masked destination shown in the UI", and
 * nothing masked it: whatever was typed went into the column and back out to every screen
 * that reads a withdrawal. The full number stays on the registered account, where HQ reads
 * it to make the transfer; the ledger keeps this.
 */
export function maskAccount(bankName: string, accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, '');
  const tail = digits.slice(-4);
  return `${bankName.trim()} ···· ${tail}`.trim();
}
