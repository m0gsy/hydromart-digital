/**
 * DEP-10: what is still in flight against a depot, in words, for the refusal message.
 * An empty list means nothing blocks switching it off.
 */
export interface DepotDeactivationProbe {
  blockers(depotId: string): Promise<string[]>;
}
