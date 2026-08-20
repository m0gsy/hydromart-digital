// Mirror of id/errors.ts — see there for why this is keyed by server error code.
export const errors = {
  byCode: {
    AUTH_CUSTOMER_NOT_FOUND: 'No account is registered with this number.',
    AUTH_INVALID_PHONE: 'That is not a valid Indonesian mobile number. Example: 081234567890.',
    AUTH_PHONE_TAKEN: 'This number is already registered. Please sign in.',
    AUTH_EMAIL_TAKEN: 'This email is already used by another account.',
    AUTH_OTP_INVALID: 'That verification code is wrong.',
    AUTH_OTP_EXPIRED: 'That verification code has expired. Request a new one.',
    AUTH_OTP_MAX_ATTEMPTS: 'Too many attempts. Request a new code.',
    AUTH_ACCOUNT_NOT_ACTIVE: 'This account is not active. Contact Hydromart support.',
  },
  missingRouteId: 'This page was opened without the record it needs. Go back and pick one.',
  address: {
    required: 'Fill in every required field.',
    latitudeRange: 'Invalid map pin: latitude must be between -90 and 90.',
    longitudeRange: 'Invalid map pin: longitude must be between -180 and 180.',
  },
};
