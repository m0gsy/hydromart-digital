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
  [NotificationEvent.PERMIT_DUE]: {
    subject: 'Izin depot perlu diperbarui di {{depot}}',
    body: 'Izin depot {{depot}} perlu diperbarui: {{items}}. Buka tautan di bawah untuk mencatat izin yang baru.',
  },
  [NotificationEvent.LAB_TEST_DUE]: {
    subject: 'Uji lab jatuh tempo di {{depot}}',
    body: 'Uji lab depot {{depot}} jatuh tempo: {{items}}. Buka tautan di bawah untuk mencatat hasilnya.',
  },
  [NotificationEvent.QUALITY_HOLD]: {
    subject: 'Quality hold depot',
    body: '{{text}} Buka tautan di bawah untuk melihat depotnya.',
  },
  [NotificationEvent.SALES_WEEKLY_REPORT]: {
    subject: 'Laporan Sales mingguan siap',
    body: 'Minggu {{week}}: laporan calon mitra untuk {{entity}} sudah siap. Buka {{link}} (masuk dulu dengan akun hydromart Anda).',
  },
  [NotificationEvent.AI_AGENT_FLAG]: {
    subject: 'Agen AI menandai kejanggalan baru',
    body: '{{who}} menandai kejanggalan baru. Buka {{link}} (masuk dulu dengan akun hydromart Anda) untuk detailnya.',
  },
  [NotificationEvent.AI_AGENT_CAP]: {
    subject: 'Agen AI berhenti: plafon tercapai',
    body: '{{who}} berhenti: plafon bulan ini tercapai. Buka {{link}} (masuk dulu dengan akun hydromart Anda) untuk detailnya.',
  },
  [NotificationEvent.AI_AGENT_STOPPED]: {
    subject: 'Agen AI dihentikan',
    body: '{{who}} dihentikan. Buka {{link}} (masuk dulu dengan akun hydromart Anda) untuk detailnya.',
  },
  [NotificationEvent.AI_LEAD_NEW]: {
    subject: 'Calon mitra baru dari formulir',
    body: 'Calon mitra baru dari formulir di {{city}}, {{province}}. Buka {{link}} (masuk dulu dengan akun hydromart Anda), lalu ambil dalam 2 jam kerja.',
  },
  [NotificationEvent.AI_LEAD_REMIND]: {
    subject: 'Calon mitra belum dihubungi (2 jam kerja)',
    body: 'Calon mitra dari {{city}} belum dihubungi lewat 2 jam kerja. Buka {{link}} (masuk dulu dengan akun hydromart Anda).',
  },
  [NotificationEvent.AI_LEAD_ESCALATE]: {
    subject: 'Calon mitra belum dihubungi (4 jam kerja)',
    body: 'Calon mitra dari {{city}} belum dihubungi lewat 4 jam kerja. Perlu tindakan Sales Lead. Buka {{link}} (masuk dulu dengan akun hydromart Anda).',
  },
  [NotificationEvent.VISIT_FINDING]: {
    subject: 'Temuan kunjungan supervisor di {{depot}}',
    body: 'Kunjungan supervisor ke {{depot}} menemukan: {{items}}. Buka tautan di bawah untuk melihat dan menindaklanjutinya.',
  },
  [NotificationEvent.FOLLOW_UP_OVERDUE]: {
    subject: 'Tindak lanjut kunjungan terlambat di {{depot}}',
    body: 'Tindak lanjut kunjungan di {{depot}} terlambat: {{items}}. Buka tautan di bawah untuk menyelesaikannya.',
  },
  [NotificationEvent.PARTNER_BILL]: {
    subject: 'Tagihan royalti {{month}} untuk {{entity}}',
    body: 'Tagihan royalti {{month}} untuk {{entity}}: {{total}}. Transfer ke {{bank}} {{number}} a.n. {{holder}}. Buka tautan di bawah untuk melihat rinciannya.',
  },
  [NotificationEvent.PARTNER_BILL_VOID]: {
    subject: 'Tagihan royalti {{month}} dibatalkan',
    body: 'Tagihan royalti {{month}} dibatalkan: {{reason}}. Tagihan pengganti akan dikirim bila ada. Buka tautan di bawah untuk melihatnya.',
  },
  [NotificationEvent.FRANCHISE_APPLICATION_SUBMITTED]: {
    subject: 'Lamaran waralaba baru: calon mitra di {{city}}, {{province}}',
    body: 'Lamaran waralaba baru dari calon mitra di {{city}}, {{province}}. Buka tautan di bawah untuk meninjaunya.',
  },
};
