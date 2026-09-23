/**
 * AUTH-5 — the fixed facts every Hydromart access token must carry, and be checked against.
 *
 * Tokens were signed and verified with a secret and nothing else: no `iss`, no `aud`, and no
 * pinned algorithm. Two consequences. A token minted for any other purpose with the same
 * secret — a signed download link, a webhook payload, anything a future feature signs — is
 * accepted as a session. And with the algorithm unpinned, verification takes whatever the
 * token's own header claims, which is the family of `alg` confusion bugs: the token tells
 * the verifier how to check it.
 *
 * Pinned here rather than in each service's config because these are not tunables. A
 * deployment where one service disagrees with another about its own issuer would fail in a
 * way that reads like an outage.
 */
export const TOKEN_ISSUER = 'hydromart-auth';
export const TOKEN_AUDIENCE = 'hydromart-api';
export const TOKEN_ALGORITHM = 'HS256';
