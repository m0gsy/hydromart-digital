/**
 * AUTH-6 — what an OTP gateway's failure body may say in our logs.
 *
 * Both SMS adapters logged `await response.text()` verbatim. That body is written by the
 * gateway, and the gateways here echo back what they were sent: the destination number, and
 * in Zenziva's case the message text — which contains the code itself. So a bad afternoon at
 * the provider wrote live OTP codes and customer phone numbers into a log that ops reads,
 * that the deploy tails, and that nothing redacts.
 *
 * The body still has to be readable, because "HTTP 400" with no detail is a support ticket
 * nobody can close. So it is kept, with the two things that must never be in it removed by
 * value — the exact code and the exact destination we just used — plus any other long digit
 * run, which is the shape both a phone number and a code take.
 */
const MAX_DETAIL = 300;

export function redactGatewayDetail(
  detail: string,
  secrets: { code?: string; phone?: string } = {},
): string {
  let out = detail.slice(0, MAX_DETAIL);
  for (const secret of [secrets.code, secrets.phone]) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  // A phone number in another format (08…, 62…, spaced, dashed) is still a run of digits.
  out = out.replace(/\d[\d\s-]{4,}\d/g, '[redacted]');
  return out.length < detail.length ? `${out}…` : out;
}
