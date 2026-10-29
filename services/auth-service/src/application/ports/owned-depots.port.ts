export const OWNED_DEPOTS_PORT = Symbol('OWNED_DEPOTS_PORT');

/**
 * How many franchise depots an owner still holds a revenue share in, asked of depot-service
 * before the owner's login is switched off.
 *
 * Fails CLOSED: an unreachable depot-service is not "zero depots". Switching off an owner who
 * still has a share leaves the depot's money split paying an account nobody can sign in to,
 * whereas a refused deactivation is one click to retry once the shares are moved.
 */
export interface OwnedDepotsPort {
  countOwned(ownerId: string): Promise<number>;
}
