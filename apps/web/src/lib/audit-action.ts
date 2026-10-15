// Audit action codes are machine tokens ("api-keys.rotate", "auth.login", "settings.changed").
// The three audit screens printed them raw, so a director read "feature-flags.express-fee.changed".
//
// ponytail: a token dictionary plus a humaniser, not a full per-code catalogue. The producers are
// open-ended (the mutation interceptor derives a code from any route), so a closed list would go
// stale the day a route is added; an unknown token still reads as words, and the raw code stays
// available on the row's title attribute for anyone who needs to grep for it.
type T = (key: string) => string;

export function actionLabel(code: string, t: T): string {
  if (!code) return code;
  const parts = code.split('.').filter(Boolean);
  if (parts.length === 0) return code;
  const lookup = (group: 'noun' | 'verb', token: string): string | null => {
    const key = `hrFix.auditAction.${group}.${token.toLowerCase()}`;
    const got = t(key);
    return got && got !== key ? got : null;
  };
  const verb = lookup('verb', parts[parts.length - 1]!);
  const nounParts = verb ? parts.slice(0, -1) : parts;
  const nouns = nounParts.map(
    (p) => lookup('noun', p) ?? p.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'),
  );
  const text = [nouns.join(' · '), verb].filter(Boolean).join(' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
