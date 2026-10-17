import { Injectable } from '@nestjs/common';

import { GlobalValidationPipe as PlatformGlobalValidationPipe } from '@hydromart/platform';

/**
 * The shared strict global validation (unknown properties rejected, payloads transformed into DTO
 * instances, NUL characters refused). auth-service kept its own byte-for-byte copy of the platform
 * pipe, which is how this one missed the NUL rule; it now extends it so they cannot drift.
 */
@Injectable()
export class GlobalValidationPipe extends PlatformGlobalValidationPipe {}
