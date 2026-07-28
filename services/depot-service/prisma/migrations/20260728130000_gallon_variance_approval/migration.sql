-- M15-11: a return that hands back more empties than the depot has outstanding is a
-- discrepancy to investigate, not an impossible event to reject — the gallons are
-- physically on the counter. Queue it for a manager under its own approval type.
ALTER TYPE "ApprovalType" ADD VALUE IF NOT EXISTS 'GALLON_VARIANCE';
