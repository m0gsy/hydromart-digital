import { Inject, Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import {
  DepotLookupError,
  InvalidShiftTransitionError,
  NotAtDepotError,
  ShiftAlreadyOpenError,
  ShiftNotFoundError,
} from '../../domain/errors';
import { haversineMeters } from '../../domain/geo';
import {
  ShiftStatus,
  acceptsAssignments,
  breakSecondsElapsed,
  breakSecondsRemaining,
  canTransition,
  expectedEndAt,
  isOpen,
} from '../../domain/shift';
import { DepotLocationPort } from '../ports/depot-location.port';
import { ShiftQuery, ShiftRecord, ShiftRepository, ShiftStatusPatch } from '../ports/shift.repository';
import { DELIVERY_TOKENS } from '../tokens';

/** A shift plus the derived numbers the app shows but never stores (design 3b). */
export interface ShiftView extends ShiftRecord {
  breakSecondsRemaining: number;
  acceptsAssignments: boolean;
}

@Injectable()
export class ShiftService {
  private static readonly HISTORY_LIMIT = 30;
  private readonly logger = new Logger(ShiftService.name);

  constructor(
    @Inject(DELIVERY_TOKENS.ShiftRepository) private readonly shifts: ShiftRepository,
    @Inject(DELIVERY_TOKENS.DepotLocation) private readonly depots: DepotLocationPort,
    private readonly config: DeliveryConfigService,
  ) {}

  /**
   * Opens a shift after verifying the courier is standing at the depot (design 3a).
   * The GPS gate fails closed — an unverified check-in would open the settlement
   * window for a courier who may not be at the depot at all.
   */
  async checkIn(driverId: string, depotId: string, lat: number, lng: number): Promise<ShiftView> {
    if (await this.shifts.findOpenByDriver(driverId)) {
      throw new ShiftAlreadyOpenError();
    }

    const depot = await this.loadDepot(depotId);
    const distance = haversineMeters(lat, lng, depot.lat, depot.lng);
    const radius = this.config.shiftCheckInRadiusMeters;
    if (distance > radius) {
      throw new NotAtDepotError(distance, radius);
    }

    const now = new Date();
    const shift = await this.shifts.open({
      driverId,
      depotId,
      checkInLat: lat,
      checkInLng: lng,
      checkInAt: now,
      expectedEndAt: expectedEndAt(now, this.config.shiftLengthHours),
    });
    this.logger.log(`Shift ${shift.id} opened by driver ${driverId} at depot ${depotId}`);
    return this.view(shift);
  }

  /** Ends the shift. Any running break is banked first so the total stays honest. */
  async checkOut(driverId: string, id: string, lat: number, lng: number): Promise<ShiftView> {
    const shift = await this.ownedOpenShift(driverId, id);
    this.assertTransition(shift.status, ShiftStatus.ENDED);
    const now = new Date();
    const patched = await this.shifts.patchStatus(id, {
      ...this.bankRunningBreak(shift, now),
      status: ShiftStatus.ENDED,
      checkOutAt: now,
      checkOutLat: lat,
      checkOutLng: lng,
    });
    this.logger.log(`Shift ${id} closed by driver ${driverId}`);
    return this.view(patched);
  }

  /**
   * ONLINE / BREAK / OFFLINE (design 3b). Leaving BREAK banks the elapsed seconds.
   * Going over quota is recorded, not blocked — see domain/shift.ts.
   */
  async setStatus(driverId: string, id: string, to: ShiftStatus): Promise<ShiftView> {
    const shift = await this.ownedOpenShift(driverId, id);
    // ENDED is only reachable through checkOut — it needs the check-out coordinates,
    // and letting it in here would close a shift with no proof of where.
    if (to === ShiftStatus.ENDED) {
      throw new InvalidShiftTransitionError(shift.status, to);
    }
    this.assertTransition(shift.status, to);
    const now = new Date();

    const patch: ShiftStatusPatch = { status: to };
    if (to === ShiftStatus.BREAK) {
      patch.breakStartedAt = now;
    } else {
      Object.assign(patch, this.bankRunningBreak(shift, now));
    }
    return this.view(await this.shifts.patchStatus(id, patch));
  }

  async current(driverId: string): Promise<ShiftView | null> {
    const shift = await this.shifts.findOpenByDriver(driverId);
    return shift ? this.view(shift) : null;
  }

  async history(driverId: string): Promise<ShiftView[]> {
    const shifts = await this.shifts.listByDriver(driverId, ShiftService.HISTORY_LIMIT);
    return shifts.map((s) => this.view(s));
  }

  /** Dispatch view (cap: tracking) — who is on shift at a depot. */
  async search(query: ShiftQuery): Promise<ShiftView[]> {
    const shifts = await this.shifts.search(query);
    return shifts.map((s) => this.view(s));
  }

  /**
   * Whether this courier may be handed a new delivery: checked in and ONLINE.
   * Called by DeliveryService.assign — it is what makes the settlement window
   * airtight (every delivered order falls inside exactly one shift).
   */
  async isAvailable(driverId: string): Promise<boolean> {
    const shift = await this.shifts.findOpenByDriver(driverId);
    return shift != null && acceptsAssignments(shift.status);
  }

  private async loadDepot(depotId: string) {
    let depot;
    try {
      depot = await this.depots.find(depotId);
    } catch (error) {
      this.logger.error(`Depot lookup failed for ${depotId}: ${(error as Error).message}`);
      throw new DepotLookupError();
    }
    if (!depot) {
      throw new DepotLookupError();
    }
    return depot;
  }

  /** Adds a running break's elapsed seconds to the total and clears the marker. */
  private bankRunningBreak(shift: ShiftRecord, now: Date): Partial<ShiftStatusPatch> {
    if (shift.status !== ShiftStatus.BREAK) {
      return {};
    }
    return {
      breakSecondsUsed: shift.breakSecondsUsed + breakSecondsElapsed(shift.breakStartedAt, now),
      breakStartedAt: null,
    };
  }

  private async ownedOpenShift(driverId: string, id: string): Promise<ShiftRecord> {
    const shift = await this.shifts.findById(id);
    // A shift that is not this driver's is reported as missing, not forbidden — a
    // courier has no business learning another courier's shift ids exist.
    if (!shift || shift.driverId !== driverId || !isOpen(shift.status)) {
      throw new ShiftNotFoundError();
    }
    return shift;
  }

  private assertTransition(from: ShiftStatus, to: ShiftStatus): void {
    if (!canTransition(from, to)) {
      throw new InvalidShiftTransitionError(from, to);
    }
  }

  private view(shift: ShiftRecord): ShiftView {
    return {
      ...shift,
      breakSecondsRemaining: breakSecondsRemaining(
        shift.breakSecondsUsed,
        this.config.shiftBreakQuotaMinutes,
      ),
      acceptsAssignments: acceptsAssignments(shift.status),
    };
  }
}
