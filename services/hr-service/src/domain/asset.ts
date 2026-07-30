import { AssetMovementKind, AssetStatus } from '../../prisma/generated/client';

/**
 * Where an asset may go next. The movement log is append-only, so the only thing that can be
 * wrong is the *current* state — which is why every transition passes through one pure
 * function instead of being re-derived at each call site.
 *
 * The shape of the rule: an item already in someone's hands cannot be handed out again
 * without a TRANSFER or a RETURN first, and LOST is terminal — finding it back is a new
 * asset row, not an undo, because the write-off already happened.
 */
export interface AssetTransition {
  /** Statuses the asset may hold for this movement to be legal. */
  from: readonly AssetStatus[];
  /** Status the asset lands in. */
  to: AssetStatus;
  /** Whether the movement must name the employee receiving it. */
  needsRecipient: boolean;
}

export const ASSET_TRANSITIONS: Readonly<Record<AssetMovementKind, AssetTransition>> = {
  ASSIGN: { from: ['AVAILABLE', 'RETURNED'], to: 'ASSIGNED', needsRecipient: true },
  TRANSFER: { from: ['ASSIGNED'], to: 'ASSIGNED', needsRecipient: true },
  // Back from a holder OR back from the workshop: both land the item in the depot's hands.
  RETURN: { from: ['ASSIGNED', 'MAINTENANCE'], to: 'RETURNED', needsRecipient: false },
  MAINTENANCE: {
    from: ['AVAILABLE', 'RETURNED', 'ASSIGNED'],
    to: 'MAINTENANCE',
    needsRecipient: false,
  },
  LOST: {
    from: ['AVAILABLE', 'RETURNED', 'ASSIGNED', 'MAINTENANCE'],
    to: 'LOST',
    needsRecipient: false,
  },
} as const;

export interface AssetMoveResult {
  status: AssetStatus;
  /** Who holds it afterwards. Only an ASSIGN/TRANSFER leaves it with a person. */
  holderId: string | null;
}

/** Human-readable rejection, or null when the move is legal. Indonesian: HR reads it. */
export function assetMoveError(
  current: AssetStatus,
  kind: AssetMovementKind,
  toEmployeeId: string | null,
): string | null {
  const rule = ASSET_TRANSITIONS[kind];
  if (!rule) return `Jenis pergerakan ${kind} tidak dikenal`;
  if (!rule.from.includes(current)) {
    return `Aset berstatus ${current} tidak bisa ${kind}`;
  }
  if (rule.needsRecipient && !toEmployeeId) {
    return `Pergerakan ${kind} membutuhkan karyawan penerima`;
  }
  return null;
}

/**
 * The state an asset lands in. Callers must have checked {@link assetMoveError} first —
 * this only computes, it does not police.
 */
export function applyAssetMove(
  kind: AssetMovementKind,
  toEmployeeId: string | null,
): AssetMoveResult {
  const rule = ASSET_TRANSITIONS[kind];
  return {
    status: rule.to,
    holderId: rule.to === 'ASSIGNED' ? toEmployeeId : null,
  };
}
