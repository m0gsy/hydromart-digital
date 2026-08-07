import { deleteAccount as base } from '../id/deleteAccount';

// English — mirrors the shape of id/deleteAccount.ts (the source of truth for keys).
export const deleteAccount: typeof base = {
  title: 'Deleting your Hydromart account',
  navLabel: 'Delete account',
  effective: 'Effective 8 August 2026',
  developer: 'Apps: Hydromart and Hydromart Ops. Developer: PT Hydromart Digital.',
  intro:
    'You may ask us to delete your account and personal data at any time, under Indonesia’s Law No. 27 of 2022 on Personal Data Protection (UU PDP). This page explains how to ask, what gets deleted, and what we keep — and why.',

  stepsHeading: 'How to request deletion',
  steps: [
    'In the app: open Account → Data & privacy → Delete account, then confirm. Your request enters a queue and is decided by the head-office team.',
    'Without the app: email privacy@hydromart-digital.com from your registered email address, or quote the phone number on your account. We verify your identity before acting.',
    'You will be notified once the request has been processed. Requests are completed within 30 working days of verification.',
  ],

  sections: [
    {
      heading: 'What is deleted or anonymised',
      body: 'Your account identity — name, phone number, email, profile photo, linked Google account — is replaced with an anonymous marker, so the account can no longer be tied to you and can no longer be used to sign in. Your date of birth is erased. Saved payment methods, favourites, and notification preferences are deleted outright. Recipient names, phone numbers, and notes in your address book are erased.',
    },
    {
      heading: 'What we keep, and why',
      body: 'Order, payment, and accounting records must be kept for at least 10 years to meet Indonesian tax and audit obligations — these are exempt from erasure by law, not by our choice. Once your account is anonymised, those records no longer point back to you. Delivery addresses remain as an address line with no name and no phone number attached, because an order that was already delivered still needs the place it went to.',
    },
    {
      heading: 'Proof of delivery',
      body: 'Hand-over photos, recipient signatures, recipient names, and the GPS point and time of hand-over are kept for at most 12 months from delivery and are then deleted automatically, including the underlying files in object storage. Deleting your account neither shortens nor extends that window.',
    },
    {
      heading: 'Staff and courier accounts',
      body: 'Accounts on the Hydromart Ops app are work accounts issued by the company. Deletion requests for staff accounts are handled through HR or head office, because attendance, payroll, and employment records carry their own statutory retention obligations.',
    },
    {
      heading: 'Download your data first',
      body: 'Deletion cannot be undone. If you want to keep a copy of your data, request an export first via Account → Data & privacy → Download data. You will receive a JSON file containing your account, profile, addresses, and consent history.',
    },
    {
      heading: 'Contact',
      body: 'Questions or requests about personal data: privacy@hydromart-digital.com.',
    },
  ],
};
