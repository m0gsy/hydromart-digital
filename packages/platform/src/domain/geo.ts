const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in km between two lat/lng points (haversine).
 *
 * Shared, not copied. order-service decides at checkout whether an address is inside a
 * depot's service radius; customer-service prints the same verdict on the depot CRM card.
 * Two implementations of "how far" would eventually disagree, and the failure would look
 * like a data problem rather than a code one — an address the shop accepted showing as
 * out-of-area to the staff member reading the card.
 */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
