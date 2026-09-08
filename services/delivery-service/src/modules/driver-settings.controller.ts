import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { DeliveryConfigService } from '../config/delivery-config.service';
import { DriverSettingsResponseDto } from './dto/responses.generated.dto';

/**
 * CA-4-29 and CA-4-37 — the four tuned numbers the courier app needs, on a route a courier
 * is allowed to call.
 *
 * The route screen read them from `GET settings/schema`, which is gated on `settingsRead`
 * (MANAGER, HEAD_OFFICE, DIREKTUR, FINANCE, SUPER_ADMIN). A courier is none of those, so
 * that call was a 403 on every load and the ETA summary the screen is built around simply
 * never appeared. The no-show screen did not even try: it hard-coded the attempt threshold
 * at 2 while the server reads it per depot, so a depot that asked for three attempts had a
 * button that unlocked early and a server that then refused it.
 *
 * Widening `settingsRead` to couriers was the wrong fix — that schema carries every tunable
 * this service has, money among them. This returns the four values the courier app renders
 * and nothing else.
 *
 * The depot comes off the TOKEN, never a query parameter: these are the numbers the courier
 * is actually held to, and a client-supplied depot could ask for a different depot's gate.
 */
@ApiTags('Driver Settings')
@ApiBearerAuth()
@Roles(Role.STAFF_DEPOT)
@Controller({ path: 'driver/settings', version: '1' })
export class DriverSettingsController {
  constructor(private readonly config: DeliveryConfigService) {}

  @ApiOkResponse({ type: DriverSettingsResponseDto })
  @Get()
  @ApiOperation({ summary: "Tunables the courier app renders, for the courier's own depot" })
  read(@CurrentUser() user: AuthenticatedUser): DriverSettingsResponseDto {
    // Null depot falls back to the GLOBAL value, which is what every other reader of these
    // settings does for an unscoped caller — not a second, different default.
    const depotId = user.depotId ?? null;
    return {
      urbanSpeedKmph: this.config.urbanSpeedKmph(depotId),
      routeStopMinutes: this.config.routeStopMinutes(depotId),
      noShowMinContactAttempts: this.config.noShowMinContactAttempts(depotId),
      noShowMinWaitSeconds: this.config.noShowMinWaitSeconds(depotId),
    };
  }
}
