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
      // "no longer point back to you" was untrue: an order row keeps its own COPY of the
      // recipient name and phone typed at checkout, and that copy is deliberately retained
      // for ten years with the rest of the financial record. The retention stands; the
      // sentence is what was wrong. See the note in ../id/deleteAccount.ts.
      body: 'Order, payment, and accounting records must be kept for at least 10 years to meet Indonesian tax and audit obligations — these are exempt from erasure by law, not by our choice. Your account itself is anonymised, so it can no longer be used to sign in and no longer identifies you. Inside that order history, however, we keep a copy of the recipient name and phone number you entered when ordering, because both are part of the transaction record we are required to retain — that copy is neither deleted nor anonymised. Delivery addresses in your address book remain as an address line with no name and no phone number attached, because an order that was already delivered still needs the place it went to.',
    },
    {
      heading: 'What is deleted in other services',
      // Written because it was not written anywhere: deletion called one service, and the
      // rest was never mentioned — not as deleted, not as exempt. The list is a contract
      // now (the erasure registry), and anything outside it is reported as unenforced
      // rather than silently skipped.
      body: 'Beyond your account and profile, deletion also reaches: your notification history and any campaign recipient rows carrying your phone number; the recipient phone on delivery records and the recipient name on proof-of-delivery records; any running subscription — which is cancelled first, so no new order goes out in your name; and support tickets together with the messages you wrote. Proof-of-delivery photos follow their own retention window of at most 12 months, described below.',
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
