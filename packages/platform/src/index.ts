export { DomainError, HTTP_STATUS } from './domain/domain-error';
export { readAllPages } from './domain/read-all';
export { pageArgs, nextCursor, type KeysetArgs, type KeysetQuery } from './domain/keyset';
export { Role } from './domain/role.enum';
export { money } from './domain/money';
export { haversineKm } from './domain/geo';
export {
  BUSINESS_TIME_ZONE,
  addLocalDays,
  addLocalMonths,
  dayStartUtc,
  localDayKey,
  localDayRange,
  localHour,
  localMinutesOfDay,
  localMonthKey,
  localMonthRange,
  startOfLocalDay,
  startOfLocalMonth,
  zoneOffsetMs,
} from './domain/business-time';
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
export { recordAuditEvent, type AuditEvent, type AuditTrailConfig } from './nest/audit-trail';
export {
  AuditMutationsInterceptor,
  AUDIT_MUTATION_SINK,
  describeRoute,
  redactBody,
  type AuditMutationSink,
} from './nest/audit-mutations.interceptor';
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
export { httpAccountNameResolver, type AccountNameResolver } from './nest/account-name-resolver';
export { InternalAuthGuard, INTERNAL_KEY_HEADER } from './nest/internal-auth.guard';
export { LOG_REDACT_PATHS, redactPaths, maskPhone } from './nest/log-redact';
export { AllExceptionsFilter } from './nest/all-exceptions.filter';
export { alertServerError } from './nest/error-alerter';
export { initSentry, captureServerError } from './nest/sentry';
export { guardProcess } from './nest/process-guard';
export { GlobalValidationPipe } from './nest/validation.pipe';
export { IsNotBefore } from './nest/date-range.validator';
export { IsWithinDays, MAX_RANGE_DAYS } from './nest/date-range-span.validator';
export { IsPublicHttpsUrl } from './nest/public-url.validator';
export { IsIanaTimezone } from './nest/timezone.validator';
export { enableMetrics } from './nest/metrics';
export {
  DEFAULT_MAX_ROWS,
  loggedQueryBounds,
  queryBoundsMiddleware,
  type QueryBoundsMiddleware,
  type QueryBoundsOptions,
  type QueryBoundsParams,
} from './nest/query-bounds';
export { protectDocs } from './nest/docs-guard';
export { requiredSecret, optionalSecret } from './config/env-secret';
export { sniffFileType, SNIFFED_MIME, type SniffedType } from './upload/file-type';
export {
  SettingType,
  SettingRow,
  SettingsSource,
  coerce,
  resolveRaw,
  SettingsCache,
} from './config/settings';
export {
  SettingsSliceService,
  type SettingDef,
  type SettingsSliceRepository,
  type PutSettingInput,
} from './config/settings-slice';
