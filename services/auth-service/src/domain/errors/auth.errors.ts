import { grantorsFor } from '@hydromart/access';

import { DomainError } from './domain-error';

/** Standard HTTP status codes referenced by domain errors (PRD §21). */
const HTTP = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY: 429,
  UNAVAILABLE: 503,
} as const;

export class InvalidPhoneNumberError extends DomainError {
  readonly code = 'AUTH_INVALID_PHONE';
  readonly status = HTTP.UNPROCESSABLE;
  constructor(value: string) {
    super(`"${value}" is not a valid Indonesian mobile number.`);
  }
}

/** BR-001: a phone number belongs to at most one account. */
export class PhoneAlreadyRegisteredError extends DomainError {
  readonly code = 'AUTH_PHONE_TAKEN';
  readonly status = HTTP.CONFLICT;
  constructor() {
    super('This phone number is already registered.');
  }
}

export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = 'AUTH_EMAIL_TAKEN';
  readonly status = HTTP.CONFLICT;
  constructor() {
    super('This email address is already registered.');
  }
}

export class CustomerNotFoundError extends DomainError {
  readonly code = 'AUTH_CUSTOMER_NOT_FOUND';
  readonly status = HTTP.NOT_FOUND;
  constructor(message = 'No account exists for the given identifier.') {
    super(message);
  }
}

/**
 * HR is moving a staff login onto a number held by a customer account that was never used.
 * Closing that account is HR's to confirm (owner decision 2026-11-20): a mistyped number would
 * otherwise close a stranger's account and hand the staff login to the stranger's phone.
 * `details` names the account so HR can tell their own employee from a typo.
 */
export class PhoneHeldByUnusedCustomerError extends DomainError {
  readonly code = 'AUTH_PHONE_UNUSED_CUSTOMER';
  readonly status = HTTP.CONFLICT;
  readonly details: { customerName: string | null; createdAt: string };
  constructor(customerName: string | null, createdAt: Date) {
    super(
      'This number belongs to a customer account that was never used; closing it needs confirmation.',
    );
    this.details = { customerName, createdAt: createdAt.toISOString() };
  }
}

/** A staff invite/role change must target a non-customer role (PRD Module 7). */
export class InvalidStaffRoleError extends DomainError {
  readonly code = 'AUTH_INVALID_STAFF_ROLE';
  readonly status = HTTP.BAD_REQUEST;
  constructor() {
    super('A staff role is required (CUSTOMER cannot be assigned here).');
  }
}

/**
 * A depot-locked role (STAFF_DEPOT, KEPALA_DEPOT) needs a depot. DepotScopeGuard fails
 * closed on a null depotId, so minting one without a depot creates an account that 403s
 * on every depot-scoped call — a broken login rather than a restricted one.
 */
export class StaffDepotRequiredError extends DomainError {
  readonly code = 'AUTH_STAFF_DEPOT_REQUIRED';
  readonly status = HTTP.BAD_REQUEST;
  constructor() {
    super('Peran staf depot wajib terikat ke satu depot.');
  }
}

/**
 * AUTHZ-1: a caller tried to grant a restricted role it may not hand out. 403 and not 400:
 * the request is well formed, the caller is simply not entitled to the role they asked for.
 *
 * The sentence names who MAY grant it, read from the same map the rule uses — it said
 * "only SUPER_ADMIN" for every role, and since CORE-1 HR may also promote to MANAGER.
 */
export class RoleEscalationError extends DomainError {
  readonly code = 'AUTH_ROLE_ESCALATION';
  readonly status = HTTP.FORBIDDEN;
  constructor(role: string) {
    super(`Peran ${role} hanya boleh diberikan oleh ${grantorsFor(role).join(' atau ')}.`);
  }
}

/**
 * CA-3-05: registered, never verified — and told to contact support.
 *
 * `AccountNotActiveError` covered three states with one code: PENDING_VERIFICATION,
 * SUSPENDED and DELETED. The web client cannot tell them apart from a code, so it showed
 * the one message it had for all three — "Akun ini tidak aktif. Hubungi dukungan
 * Hydromart." Somebody who had signed up and closed the app before typing the OTP was sent
 * to a support queue for something they could fix themselves in ten seconds.
 *
 * A separate code because the ANSWER is different, not because the status is: suspended and
 * deleted genuinely need a human. This one needs a new code sent to the same phone.
 */
export class AccountPendingVerificationError extends DomainError {
  readonly code = 'AUTH_ACCOUNT_PENDING_VERIFICATION';
  readonly status = HTTP.FORBIDDEN;
  constructor(message = 'This number is registered but not verified yet.') {
    super(message);
  }
}

/**
 * A staff-only door (the Ops app, /hq/login, the manager phone login) was given a number that
 * is no staff login. Refused rather than signed up as a customer: that is how staff whose HR
 * record carried a wrong number kept landing in the shop (2026-11).
 */
export class NotStaffError extends DomainError {
  readonly code = 'AUTH_NOT_STAFF';
  readonly status = HTTP.FORBIDDEN;
  constructor() {
    super('This number is not registered as Hydromart staff.');
  }
}

/**
 * The customer app was given a staff login's number. Staff sign in to the Ops app, where their
 * consoles live; the customer binary does not carry them, so a staff session there opened on
 * screens that do not exist (owner decision 2026-11-20).
 */
export class StaffAccountError extends DomainError {
  readonly code = 'AUTH_STAFF_ACCOUNT';
  readonly status = HTTP.FORBIDDEN;
  constructor() {
    super('This number belongs to a staff account. Sign in with the Hydromart Ops app.');
  }
}

export class AccountNotActiveError extends DomainError {
  readonly code = 'AUTH_ACCOUNT_NOT_ACTIVE';
  readonly status = HTTP.FORBIDDEN;
  constructor(message = 'This account is not active.') {
    super(message);
  }
}

/** OTP challenge could not be found, is expired, or already consumed. */
export class OtpInvalidError extends DomainError {
  readonly code = 'AUTH_OTP_INVALID';
  readonly status = HTTP.UNAUTHORIZED;
  constructor(message = 'The verification code is invalid or has expired.') {
    super(message);
  }
}

/**
 * E6: expiry is a different thing from a wrong guess, and only the customer can tell
 * them apart by what they do next — one asks for a new code, the other retypes. They
 * shared `AUTH_OTP_INVALID`, so the only thing distinguishing them on screen was the
 * English sentence, which is what the customer could not read.
 */
export class OtpExpiredError extends DomainError {
  readonly code = 'AUTH_OTP_EXPIRED';
  readonly status = HTTP.UNAUTHORIZED;
  constructor() {
    super('The verification code has expired.');
  }
}

/** BR-002 boundary: too many wrong attempts for one OTP challenge. */
export class OtpMaxAttemptsError extends DomainError {
  readonly code = 'AUTH_OTP_MAX_ATTEMPTS';
  readonly status = HTTP.TOO_MANY;
  constructor() {
    super('Too many incorrect attempts. Please request a new code.');
  }
}

export class OtpResendCooldownError extends DomainError {
  readonly code = 'AUTH_OTP_COOLDOWN';
  readonly status = HTTP.TOO_MANY;
  constructor(retryAfterSeconds: number) {
    super(`Please wait ${retryAfterSeconds}s before requesting another code.`);
  }
}

/**
 * The code was minted and stored, and the gateway that carries it did not answer.
 *
 * A distinct error rather than letting the adapter's `fetch failed` fall through: the
 * signup screen used to show a bare 500 for an outage that is neither the caller's fault
 * nor permanent, and "try again" is the one thing that actually helps here.
 */
export class OtpDeliveryUnavailableError extends DomainError {
  readonly code = 'AUTH_OTP_UNDELIVERABLE';
  readonly status = HTTP.UNAVAILABLE;
  constructor() {
    super('Kode OTP tidak bisa dikirim sekarang. Coba lagi sebentar lagi.');
  }
}

export class InvalidRefreshTokenError extends DomainError {
  readonly code = 'AUTH_INVALID_REFRESH_TOKEN';
  readonly status = HTTP.UNAUTHORIZED;
  constructor(message = 'The session is invalid or has expired.') {
    super(message);
  }
}

/**
 * A refresh token that was rotated a moment ago, presented again.
 *
 * Two requests (two tabs, a retry, the app waking while a push handler runs) can both carry
 * the cookie that was current before the first one's rotation landed. The second one is not
 * theft — and treating it as theft revoked the whole family and signed the person out, which
 * costs an SMS OTP. It gets a distinct, non-destructive answer instead: no session is issued
 * to it, the family is left alone, and the caller retries with the credential the first
 * request already put in place.
 */
export class RefreshTokenRotatedError extends DomainError {
  readonly code = 'AUTH_REFRESH_ROTATED';
  readonly status = HTTP.CONFLICT;
  constructor(message = 'This session was just renewed. Retry with the current credential.') {
    super(message);
  }
}

export class InvalidGoogleTokenError extends DomainError {
  readonly code = 'AUTH_INVALID_GOOGLE_TOKEN';
  readonly status = HTTP.UNAUTHORIZED;
  constructor(message = 'The Google credential could not be verified.') {
    super(message);
  }
}

/* ---------- UU PDP tahap 1 (item 13) ---------- */

/** One open request per right: a second one would queue the same work twice. */
export class DuplicateDataSubjectRequestError extends DomainError {
  readonly code = 'PDP_REQUEST_OPEN';
  readonly status = HTTP.CONFLICT;
  constructor() {
    super('Permintaan sejenis masih diproses.');
  }
}

/** Promoting a customer who has asked to be deleted: the request has to be decided first. */
export class ErasureRequestOpenError extends DomainError {
  readonly code = 'PDP_ERASURE_OPEN';
  readonly status = HTTP.CONFLICT;
  constructor() {
    super(
      'Orang ini punya permintaan hapus data (PDP) yang belum diputuskan. Setujui atau tolak dulu di antrean PDP sebelum dijadikan staf.',
    );
  }
}

export class DataSubjectRequestNotFoundError extends DomainError {
  readonly code = 'PDP_REQUEST_NOT_FOUND';
  readonly status = HTTP.NOT_FOUND;
  constructor() {
    super('Permintaan tidak ditemukan.');
  }
}

/**
 * Owner decision 2026-10-14: an account with orders still in flight is not erased. The
 * delivery, the payment and the reversal all need somebody on the other end. A SUPER_ADMIN
 * may force it, knowing the count.
 */
export class AccountHasOpenOrdersError extends DomainError {
  readonly code = 'PDP_OPEN_ORDERS';
  readonly status = HTTP.CONFLICT;
  constructor(readonly openOrders: number) {
    super(
      `Akun ini masih punya ${openOrders} pesanan yang belum selesai. ` +
        'Tunggu pesanan selesai atau dibatalkan, atau minta Super Admin memaksa penghapusan.',
    );
  }
}

/** Deciding twice would re-run an irreversible side effect. */
export class DataSubjectRequestAlreadyDecidedError extends DomainError {
  readonly code = 'PDP_REQUEST_DECIDED';
  readonly status = HTTP.CONFLICT;
  constructor() {
    super('Permintaan ini sudah diputuskan.');
  }
}

/**
 * CA-3-54: a full data export is a queue decision, not a download button.
 *
 * The approval queue existed and worked; this one route walked around it. The only thing
 * that ever gated it was a browser screen, and a cookie and curl skipped that.
 */
export class DataExportNotApprovedError extends DomainError {
  readonly code = 'PDP_EXPORT_NOT_APPROVED';
  readonly status = HTTP.FORBIDDEN;
  constructor() {
    super('Ekspor data belum disetujui. Kirim permintaan dulu, kantor pusat akan meninjau.');
  }
}

/**
 * CA-3-54, owner decision 2026-09-04: an approval is good for seven days.
 *
 * The payload is rebuilt at download time, so a year-old approval would otherwise be a
 * permanent door onto TODAY's data — not onto the data head office actually looked at.
 */
export class DataExportApprovalExpiredError extends DomainError {
  readonly code = 'PDP_EXPORT_APPROVAL_EXPIRED';
  readonly status = HTTP.FORBIDDEN;
  constructor() {
    super('Persetujuan ekspor sudah lewat 7 hari. Kirim permintaan baru untuk data terkini.');
  }
}

/**
 * The dispatch driver roster is read whole, so it needs a ceiling — and PR6's rule is that
 * a ceiling REFUSES rather than truncating. A silently truncated roster is a courier who
 * exists but cannot be dispatched, which reads on screen as "that courier has no shift".
 *
 * Only reachable network-wide (HQ with no depot filter); one depot's courier list is two
 * orders of magnitude below the limit.
 */
export class PicRosterTooLargeError extends DomainError {
  readonly code = 'AUTH_PIC_ROSTER_TOO_LARGE';
  readonly status = HTTP.UNPROCESSABLE;
  constructor(max: number) {
    super(`Daftar staf yang boleh jadi PIC melebihi ${max} baris.`);
  }
}

export class DriverRosterTooLargeError extends DomainError {
  readonly code = 'AUTH_DRIVER_ROSTER_TOO_LARGE';
  readonly status = HTTP.UNPROCESSABLE;
  constructor(max: number) {
    super(`Daftar kurir melebihi ${max} baris. Persempit ke satu depot.`);
  }
}

/**
 * Withdrawing TERMS/PRIVACY would leave a live account with no lawful basis for the
 * processing it keeps asking for. That request is account deletion, and saying so is
 * more honest than accepting a withdrawal nothing downstream can honour.
 */
export class ConsentNotWithdrawableError extends DomainError {
  readonly code = 'PDP_CONSENT_MANDATORY';
  readonly status = HTTP.UNPROCESSABLE;
  constructor(purpose: string) {
    super(
      `Persetujuan ${purpose} tidak dapat dicabut selama akun aktif. Ajukan penghapusan akun bila ingin berhenti sepenuhnya.`,
    );
  }
}

/**
 * K1.4: confirm was called with no outstanding phone-change challenge — never requested,
 * already spent, or expired and swept.
 *
 * Deliberately distinct from `OtpInvalidError`. There is nothing to hide here: the caller
 * is already authenticated as this account, so "you have no pending change" tells them
 * only about themselves, and collapsing it into "wrong code" would leave somebody typing
 * a code that could never have worked.
 */
export class NoPendingPhoneChangeError extends DomainError {
  readonly code = 'AUTH_NO_PENDING_PHONE_CHANGE';
  readonly status = HTTP.BAD_REQUEST;
  constructor() {
    super('Tidak ada permintaan ganti nomor yang menunggu. Mulai lagi dari awal.');
  }
}

/**
 * K1.4: the new number is the one already on the account. Not an error of state — an
 * error of intent, and answering 200 would send a code to a number that is already theirs
 * and then "change" nothing.
 */
export class PhoneUnchangedError extends DomainError {
  readonly code = 'AUTH_PHONE_UNCHANGED';
  readonly status = HTTP.BAD_REQUEST;
  constructor() {
    super('Nomor itu sudah menjadi nomor akun ini.');
  }
}

/** HD-3: no signing key is configured, which is the kill switch for AI and machine tokens. */
export class ExternalTokensOffError extends DomainError {
  readonly code = 'AUTH_EXTERNAL_TOKENS_OFF';
  readonly status = HTTP.UNAVAILABLE;
  readonly switchedOff = true;
  constructor() {
    super('AI and machine access is switched off.');
  }
}

/** HD-3: the AI web is for staff; a customer account has nothing to do there. */
export class HandoffNotForCustomersError extends DomainError {
  readonly code = 'AUTH_HANDOFF_STAFF_ONLY';
  readonly status = HTTP.FORBIDDEN;
  constructor() {
    super('Only staff accounts can sign in to the AI web.');
  }
}

/** AI-3b: no AI web return address is configured, so no handoff code is issued. */
export class HandoffReturnUnsetError extends DomainError {
  readonly code = 'AUTH_HANDOFF_RETURN_UNSET';
  readonly status = HTTP.UNAVAILABLE;
  constructor() {
    super('The AI web is not connected yet.');
  }
}

/**
 * AI-3b: the link asked for the code to go somewhere other than the AI web's callback. Refused,
 * because whoever holds the code and its verifier gets a token for the person who signed in.
 */
export class HandoffReturnRefusedError extends DomainError {
  readonly code = 'AUTH_HANDOFF_RETURN_REFUSED';
  readonly status = HTTP.BAD_REQUEST;
  constructor() {
    super('This sign-in link does not lead back to the HYDROMART AI web.');
  }
}

/** HD-3: unknown, used, expired, or presented with the wrong PKCE verifier. One answer for all. */
export class InvalidHandoffCodeError extends DomainError {
  readonly code = 'AUTH_HANDOFF_INVALID';
  readonly status = HTTP.UNAUTHORIZED;
  constructor() {
    super('The sign-in code is invalid or has expired. Start the sign-in again.');
  }
}

/** HD-3: too many sign-ins waiting to be exchanged at once; nothing is evicted to make room. */
export class HandoffBusyError extends DomainError {
  readonly code = 'AUTH_HANDOFF_BUSY';
  readonly status = HTTP.TOO_MANY;
  constructor() {
    super('Too many sign-ins are in progress. Try again in a minute.');
  }
}

/** HD-3: unknown account, wrong secret, or a secret past its day. One answer for all. */
export class InvalidMachineCredentialsError extends DomainError {
  readonly code = 'AUTH_MACHINE_INVALID';
  readonly status = HTTP.UNAUTHORIZED;
  constructor() {
    super('The machine account credentials are invalid or have expired.');
  }
}

/** HD-4: no TOTP_ENCRYPTION_KEY, so no authenticator can be set up or checked. */
export class TotpOffError extends DomainError {
  readonly code = 'AUTH_TOTP_OFF';
  readonly status = HTTP.UNAVAILABLE;
  readonly switchedOff = true;
  constructor() {
    super('Authenticator sign-in is not set up on this server.');
  }
}

/** HD-4: a role that needs the authenticator step has not set one up. */
export class TotpEnrolmentRequiredError extends DomainError {
  readonly code = 'AUTH_TOTP_ENROLMENT_REQUIRED';
  readonly status = HTTP.FORBIDDEN;
  constructor() {
    super('Set up an authenticator app in your HYDROMART account before signing in to the AI web.');
  }
}

/**
 * HD-4: the handoff code and verifier were right and only the second factor is missing.
 * The code is kept for one more presentation, so the AI web can ask for it and try again.
 */
export class TotpRequiredError extends DomainError {
  readonly code = 'AUTH_TOTP_REQUIRED';
  readonly status = HTTP.UNAUTHORIZED;
  constructor() {
    super('Enter the 6-digit code from your authenticator app.');
  }
}

/** HD-4: a wrong, expired or already used code (authenticator or recovery). */
export class InvalidTotpCodeError extends DomainError {
  readonly code = 'AUTH_TOTP_INVALID';
  readonly status = HTTP.UNPROCESSABLE;
  constructor() {
    super('The code is wrong or has already been used.');
  }
}

/** HD-4: five wrong codes in a row; the step is closed for a while. */
export class TotpLockedError extends DomainError {
  readonly code = 'AUTH_TOTP_LOCKED';
  readonly status = HTTP.TOO_MANY;
  readonly details: { retryAfterSeconds: number };
  constructor(retryAfterSeconds: number) {
    super(`Too many wrong codes. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`);
    this.details = { retryAfterSeconds };
  }
}

/** HD-4: an authenticator is already set up; only a reset by a SUPER_ADMIN replaces it. */
export class TotpAlreadyEnrolledError extends DomainError {
  readonly code = 'AUTH_TOTP_ENROLLED';
  readonly status = HTTP.CONFLICT;
  constructor() {
    super('An authenticator is already set up. Ask a SUPER_ADMIN to reset it.');
  }
}

/** HD-4: confirming before starting, or after the pending enrolment was replaced. */
export class TotpNotStartedError extends DomainError {
  readonly code = 'AUTH_TOTP_NOT_STARTED';
  readonly status = HTTP.CONFLICT;
  constructor() {
    super('Start setting up the authenticator first.');
  }
}

/** HD-4: only a SUPER_ADMIN resets an authenticator, and never their own. */
export class TotpResetForbiddenError extends DomainError {
  readonly code = 'AUTH_TOTP_RESET_FORBIDDEN';
  readonly status = HTTP.FORBIDDEN;
  constructor() {
    super('Only another SUPER_ADMIN can reset this authenticator.');
  }
}
