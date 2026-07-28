export { DomainError, HTTP_STATUS } from './domain/domain-error';
export { Role } from './domain/role.enum';
export {
  runImport,
  type ImportRowResult,
  type ImportRowOutcome,
  type ImportRowStatus,
  type ImportSummary,
} from './domain/import-runner';
export { AuthenticatedUser, RequestContext } from './http/authenticated-user';
export { getRequestContext } from './http/request-context';
export {
  Public,
  Roles,
  CurrentUser,
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from './nest/decorators';
export { JwtAuthGuard } from './nest/jwt-auth.guard';
export { RolesGuard } from './nest/roles.guard';
export { DepotScopeGuard } from './nest/depot-scope.guard';
export {
  assertDepotAccess,
  assertDepotOwnership,
  depotScopeFilter,
  isDepotLocked,
  DEPOT_LOCKED_ROLES,
} from './nest/depot-scope';
export { InternalAuthGuard, INTERNAL_KEY_HEADER } from './nest/internal-auth.guard';
export { AllExceptionsFilter } from './nest/all-exceptions.filter';
export { alertServerError } from './nest/error-alerter';
export { GlobalValidationPipe } from './nest/validation.pipe';
export { IsNotBefore } from './nest/date-range.validator';
export { IsPublicHttpsUrl } from './nest/public-url.validator';
export { IsIanaTimezone } from './nest/timezone.validator';
export { enableMetrics } from './nest/metrics';
export { requiredSecret, optionalSecret } from './config/env-secret';
export {
  SettingType,
  SettingRow,
  SettingsSource,
  coerce,
  resolveRaw,
  SettingsCache,
} from './config/settings';
