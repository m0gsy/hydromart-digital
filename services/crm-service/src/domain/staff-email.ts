import { NotificationEvent } from './notification-event';

/** One email per kind of staff notification: `{{tokens}}` are the event's own vars. */
export interface StaffEmailTemplate {
  subject: string;
  body: string;
}

/**
 * Owner rule 24 Nov 2026: every staff notification an n8n workflow raises through the machine
 * route (notifications/external/*) goes out on every channel: the bell and push, email, and
 * WhatsApp (once Meta is ready). This table is the email's copy, one entry per kind, Indonesian
 * like the bell and naming nothing the bell does not (staff-email.spec.ts fails a kind the
 * external route raises without an entry here). Everything else is shared: crm hands the email
 * to the notification's own recipients when it files the row, and admin-service adds the link to
 * the notification's screen and the switch line, keeps to each person's email switch (the push's
 * toggle, STAFF_TOGGLE_FOR_EVENT) and sends it as plain text.
 */
export const STAFF_EMAIL_TEMPLATES: Partial<Record<NotificationEvent, StaffEmailTemplate>> = {
  [NotificationEvent.MORNING_SUMMARY]: {
    subject: 'Persetujuan yang menunggu Anda pagi ini',
    body: 'Persetujuan yang menunggu Anda: {{summary}}.{{oldest}} Buka tautan di bawah untuk memutuskannya.',
  },
  [NotificationEvent.AI_ACCESS_REQUESTED]: {
    subject: 'Permintaan akses AI web: {{what}}',
    body: '{{who}} meminta akses AI web untuk {{what}}. Buka tautan di bawah untuk memberikannya.',
  },
  [NotificationEvent.MAINTENANCE_DUE]: {
    subject: 'Perawatan jatuh tempo di {{depot}}',
    body: 'Perawatan jatuh tempo di {{depot}}: {{items}}. Buka tautan di bawah untuk menjadwalkan servis.',
  },
  [NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED]: {
    subject: 'Lamaran waralaba baru: calon mitra di {{city}}, {{province}}',
    body: 'Lamaran waralaba baru dari calon mitra di {{city}}, {{province}}. Buka tautan di bawah untuk meninjaunya.',
  },
};
