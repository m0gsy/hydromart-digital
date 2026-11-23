/** The secret in groups of four, as authenticator apps print it: easier to type by hand. */
export function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}
