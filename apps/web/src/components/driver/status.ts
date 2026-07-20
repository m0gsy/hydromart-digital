import type { DeliveryStatus } from '@/lib/types';

/** Indonesian labels for the courier-facing delivery lifecycle (shared by list + detail). */
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  ASSIGNED: 'Ditugaskan',
  PICKED_UP: 'Diambil',
  ON_DELIVERY: 'Diantar',
  DELIVERED: 'Selesai',
  FAILED: 'Gagal',
  RESCHEDULED: 'Dijadwalkan ulang',
};

type BadgeTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning';

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, BadgeTone> = {
  ASSIGNED: 'neutral',
  PICKED_UP: 'brand',
  ON_DELIVERY: 'warning',
  DELIVERED: 'success',
  FAILED: 'danger',
  RESCHEDULED: 'warning',
};
