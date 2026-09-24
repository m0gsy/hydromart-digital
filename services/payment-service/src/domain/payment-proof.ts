/** Both adapters build `<base>[/uploads]/payment-proof/<uuid>.<ext>`; the key starts there. */
export function proofKeyFromUrl(url: string): string | null {
  const at = url.indexOf('payment-proof/');
  return at === -1 ? null : url.slice(at);
}
