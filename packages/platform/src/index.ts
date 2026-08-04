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
  Can,
  CurrentUser,
  IS_PUBLIC_KEY,
  ROLES_KEY,
  CAPABILITY_KEY,
} from './nest/decorators';
export { assertCapability } from './nest/capability';
export {
  startCapabilityRefresh,
  httpCapabilityLoader,
  capabilityMatrixStatus,
  resetCapabilityRefreshStatus,
  type CapabilityMatrixStatus,
} from './nest/capability-refresh';
export { rbacHealth, type RbacHealth } from './nest/rbac-health';
export { JwtAuthGuard } from './nest/jwt-auth.guard';
export { RolesGuard } from './nest/roles.guard';
export { DepotScopeGuard } from './nest/depot-scope.guard';
export {
  assertDepotAccess,
  assertDepotOwnership,
  depotScopeIds,
  depotWhere,
  isDepotLocked,
  isDepotResolved,
  isDepotScoped,
  DEPOT_LOCKED_ROLES,
  DEPOT_SCOPED_ROLES,
} from './nest/depot-scope';
export {
  configureDepotScope,
  httpDepotScopeResolver,
  resetDepotScope,
  resolveDepotScope,
  depotScopeStatus,
  type DepotScopeStatus,
} from './nest/depot-scope-resolver';
export { httpSuperiorResolver, type SuperiorResolver } from './nest/superior-resolver';
export { InternalAuthGuard, INTERNAL_KEY_HEADER } from './nest/internal-auth.guard';
export { AllExceptionsFilter } from './nest/all-exceptions.filter';
export { alertServerError } from './nest/error-alerter';
export { GlobalValidationPipe } from './nest/validation.pipe';
export { IsNotBefore } from './nest/date-range.validator';
export { IsPublicHttpsUrl } from './nest/public-url.validator';
export { IsIanaTimezone } from './nest/timezone.validator';
export { enableMetrics } from './nest/metrics';
export { protectDocs } from './nest/docs-guard';
export { requiredSecret, optionalSecret } from './config/env-secret';
export {
  SettingType,
  SettingRow,
  SettingsSource,
  coerce,
  resolveRaw,
  SettingsCache,
} from './config/settings';
