/** DI tokens for application ports. */
export const CUSTOMER_TOKENS = {
  ProfileRepository: Symbol('ProfileRepository'),
  AddressRepository: Symbol('AddressRepository'),
  NotificationPreferenceRepository: Symbol('NotificationPreferenceRepository'),
} as const;
