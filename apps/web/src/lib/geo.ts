/** Ask the browser for the current GPS position. Shared by PoD capture and shift check-in. */
export function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Perangkat tidak mendukung lokasi GPS.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      () => reject(new Error('Lokasi GPS ditolak. Aktifkan izin lokasi.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}
