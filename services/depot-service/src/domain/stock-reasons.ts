// The reason texts the stock ledger writes that other readers classify by their start.
// ONE copy: the writers (gallon-issue.service, inventory.service) and the AI read API's wastage
// reader (ai-stock repository) import it, so a reworded writer cannot silently turn a loan or a
// reversal into "wastage".

/** A gallon lent with a delivery leaves the GALON line as a negative adjustment: a loan, not a loss. */
export const LENT_GALLON_REASON = 'Galon keluar (deposit)';

/** HQ rejected an opname the depot had already applied: the count is put back by an opposite adjustment. */
export const OPNAME_REVERSAL_REASON = 'Opname ditolak HQ';
