import { DomainError, HTTP_STATUS } from '@hydromart/platform';

/** No face above the detector's score floor. hr-service turns this into a PENDING punch. */
export class NoFaceError extends DomainError {
  readonly code = 'NO_FACE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Tidak ada wajah yang terdeteksi.');
  }
}

/**
 * Smaller than the detector's input. The area resize that matches OpenCV degrades to
 * nearest-neighbour when it has to enlarge, and a face that small is not worth matching.
 */
export class ImageTooSmallError extends DomainError {
  readonly code = 'IMAGE_TOO_SMALL';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor(min: number) {
    super(`Foto terlalu kecil: sisi terpanjang minimal ${min} px.`);
  }
}

/** Not a JPEG this service can decode. */
export class UnreadableImageError extends DomainError {
  readonly code = 'UNREADABLE_IMAGE';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Foto tidak bisa dibaca sebagai JPEG.');
  }
}

/** The queue is full: the caller treats it like the engine being down (PENDING), not a crash. */
export class EngineBusyError extends DomainError {
  readonly code = 'ENGINE_BUSY';
  readonly status = HTTP_STATUS.SERVICE_UNAVAILABLE;
  constructor() {
    super('Mesin wajah sedang penuh, coba lagi.');
  }
}
