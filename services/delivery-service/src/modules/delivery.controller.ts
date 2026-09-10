import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  Can,
  AuthenticatedUser,
  CurrentUser,
  assertDepotAccess,
  depotScopeIds,
} from '@hydromart/platform';

import { DeliveryService } from '../application/services/delivery.service';
import { DeliveryRecord } from '../application/ports/delivery.repository';
import { Page } from '../application/pagination';
import { AssignDeliveryDto, FailDeliveryDto, ListDeliveriesQueryDto } from './dto/delivery.dto';
import {
  DeliveryResponseDto,
  PagedDeliveryResponseDto,
  ProofLinksResponseDto,
} from './dto/responses.generated.dto';

@ApiTags('Deliveries (staff)')
@ApiBearerAuth()
@Can('tracking')
@Controller({ path: 'deliveries', version: '1' })
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @ApiOkResponse({ type: DeliveryResponseDto })
  @Post()
  @ApiOperation({ summary: 'Assign a driver to an order (advances the order to DRIVER_ASSIGNED)' })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssignDeliveryDto,
    @Headers('authorization') authorization: string,
  ): Promise<DeliveryRecord> {
    /*
     * `depotId` arrives in the BODY, and nothing checked it. `tracking` includes
     * KEPALA_DEPOT — a depot-locked role — so a depot head could name another depot's id
     * and dispatch that depot's courier. `DepotScopeGuard` never saw it: the guard reads a
     * parameter called `depotId`, and a body field is not a parameter.
     *
     * It has to be here rather than in the service: the handler passes `user.sub`, a bare
     * string, so the service below has no caller to check.
     *
     * Guarded on PRESENCE, not `?? null`. The vector is naming ANOTHER depot's id; an
     * absent one claims no depot at all, and both consoles send
     * `order.depotId ?? undefined` — so an unconditional check would start 403-ing a
     * depot-less order that dispatches fine today, which is a different change from the
     * one this closes.
     */
    if (dto.depotId) assertDepotAccess(user, dto.depotId);
    return this.deliveries.assign(
      user.sub,
      {
        orderId: dto.orderId,
        orderNumber: dto.orderNumber,
        driverId: dto.driverId,
        driverName: dto.driverName,
        depotId: dto.depotId,
        destinationAddress: dto.destinationAddress,
        destinationLat: dto.destinationLat,
        destinationLng: dto.destinationLng,
        recipientPhone: dto.recipientPhone,
        driverPhone: dto.driverPhone,
        items: dto.items,
        codAmount: dto.codAmount,
        notes: dto.notes,
      },
      authorization,
    );
  }

  /*
   * B2: the two ways a dispatcher takes a delivery back off a courier who cannot finish it.
   *
   * Everything the domain allows here — ASSIGNED / PICKED_UP / ON_DELIVERY to RESCHEDULED
   * or FAILED — existed already, and every route to it was keyed to the courier holding
   * the delivery. A dead phone froze the order and held its stock, and dispatch could not
   * route around it: `assign` refuses while a live row exists.
   *
   * Release keeps the customer's order alive and hands it back to the queue; cancel ends
   * it, which is what returns the checkout hold. Depot-scoped, like every other staff route
   * on this controller.
   */
  @ApiOkResponse({ type: DeliveryResponseDto })
  @Post(':id/release')
  @ApiOperation({ summary: 'Staff: take a stuck delivery off its courier, back to dispatch' })
  release(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailDeliveryDto,
    @Headers('authorization') authorization: string,
  ): Promise<DeliveryRecord> {
    return this.deliveries.releaseByStaff(user, id, dto.reason, authorization);
  }

  @ApiOkResponse({ type: DeliveryResponseDto })
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Staff: end a stuck delivery and cancel its order' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailDeliveryDto,
    @Headers('authorization') authorization: string,
  ): Promise<DeliveryRecord> {
    return this.deliveries.cancelByStaff(user, id, dto.reason, authorization);
  }

  @ApiOkResponse({ type: PagedDeliveryResponseDto })
  @Get()
  @ApiOperation({ summary: 'List all deliveries (staff), optionally filtered by status' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<Page<DeliveryRecord>> {
    // Depot-locked operator/manager are forced to their own depot; HQ keeps the optional ?depotId.
    const depotIds = depotScopeIds(user, query.depotId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { depotId: _dropped, ...rest } = query;
    return this.deliveries.listAll({ ...rest, depotIds });
  }

  /**
   * CA-4-49 — the proof photo and signature, as links that expire.
   *
   * Owner decision 2026-09-04: expiring signed links, not a public bucket. The stored
   * value is unchanged — it is what every historical row holds and what payout-service's
   * receipt allowlist prefix-matches on — and nothing renders it directly any more.
   *
   * A separate JSON route rather than a field on the delivery response, for two reasons.
   * A signed URL on the main read is minted on every load whether or not anyone opens the
   * photo, and it then rides into every cache and log that response touches. And a
   * REDIRECT route would have been worse: the browser fetches an `<img src>` without the
   * session cookie when the gateway is a different origin from the app, so the image would
   * simply 401. Fetched through the app's own authenticated client, none of that applies —
   * and the signature on the returned URL is what authorises the object store, so the
   * image request itself needs no credentials at all.
   */
  @ApiOkResponse({ type: ProofLinksResponseDto })
  @Get(':id/proof-links')
  @ApiOperation({ summary: 'Time-limited links to the proof photo and signature' })
  async proofLinks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ photoUrl: string | null; signatureUrl: string | null }> {
    const delivery = await this.deliveries.getAny(id);
    // The same by-id vector the detail route closes: a depot-locked operator may only read
    // their own depot's delivery, and therefore only its photos.
    assertDepotAccess(user, delivery.depotId);
    const [photoUrl, signatureUrl] = await Promise.all([
      this.deliveries.signedPhotoUrl(delivery.proof?.photoUrl ?? null),
      this.deliveries.signedPhotoUrl(delivery.proof?.signatureUrl ?? null),
    ]);
    return { photoUrl, signatureUrl };
  }

  @ApiOkResponse({ type: DeliveryResponseDto })
  @Get(':id')
  @ApiOperation({ summary: 'Get any delivery by id (staff)' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeliveryRecord> {
    const delivery = await this.deliveries.getAny(id);
    // Close the by-id vector: a depot-locked operator/manager may only read their own depot's delivery.
    assertDepotAccess(user, delivery.depotId);
    return delivery;
  }
}
