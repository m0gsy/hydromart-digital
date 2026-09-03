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
    AUTH_OTP_COOLDOWN: 'A new code can be requested shortly. Check the SMS already sent first.',
    AUTH_OTP_UNDELIVERABLE: 'The code could not be sent right now. Try again.',
    AUTH_ACCOUNT_PENDING_VERIFICATION:
      'This number is registered but not verified yet. We are sending a new code.',
    AUTH_ACCOUNT_NOT_ACTIVE: 'This account is not active. Contact Hydromart support.',
    ORDER_CATALOG_UNAVAILABLE:
      'The product catalogue is busy right now. Wait a moment and try again.',
  },
  missingRouteId: 'This page was opened without the record it needs. Go back and pick one.',
  geo: {
    denied: 'Location access denied. Allow location for this app in Settings, then try again.',
    unavailable: 'Could not get a location. Turn on Location/GPS on your device, then try again.',
    timeout: 'No location signal yet. Try again somewhere more open.',
    unsupported: 'This device does not support location.',
  },
  address: {
    required: 'Fill in every required field.',
    latitudeRange: 'Invalid map pin: latitude must be between -90 and 90.',
    longitudeRange: 'Invalid map pin: longitude must be between -180 and 180.',
  },
};
