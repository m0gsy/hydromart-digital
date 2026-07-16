import { privacy as base } from '../id/privacy';

// English — mirrors the shape of id/privacy.ts (the source of truth for keys).
export const privacy: typeof base = {
  title: 'Privacy Policy',
  effective: 'Effective 16 July 2026',
  intro:
    'Hydromart respects your privacy. This policy explains what personal data we collect, why, how long we keep it, and your rights under Indonesia’s Law No. 27 of 2022 on Personal Data Protection (UU PDP).',
  sections: [
    {
      heading: 'Data we collect',
      body: 'When you register and order: your name, phone number, email (optional), and delivery address. When an order is delivered, the courier captures proof of delivery — a hand-over photo, the recipient’s signature, the recipient’s name, and the GPS location and time of hand-over.',
    },
    {
      heading: 'How we use it',
      body: 'Data is used to process and deliver your orders, verify hand-over (proof of delivery), provide customer support, run points & rewards, and meet legal obligations. Proof of delivery is the lawful record that an order was received.',
    },
    {
      heading: 'Legal basis & consent',
      body: 'We process data based on your consent (given at registration and when the recipient signs for a delivery) and to perform your order. You may withdraw consent at any time; as a result we may be unable to continue certain services.',
    },
    {
      heading: 'Sharing',
      body: 'Data is shared only with the depot and courier handling your order, and with infrastructure providers (file storage, OTP delivery) as strictly needed. We do not sell your personal data.',
    },
    {
      heading: 'Storage & retention',
      body: 'Account data is kept while your account is active. Proof-of-delivery data (photo, signature, recipient name, location) is kept for at most 12 months after hand-over, then deleted automatically. Photo/signature files in object storage are removed by a bucket lifecycle rule on the same schedule.',
    },
    {
      heading: 'Security',
      body: 'OTP codes and session tokens are stored hashed, connections are encrypted (HTTPS), and data access is restricted by role. No system is 100% secure, but we apply reasonable measures to protect your data.',
    },
    {
      heading: 'Your rights',
      body: 'You may access, correct, and request deletion of your personal data, withdraw consent, and object to certain processing. To exercise these rights, contact us below.',
    },
    {
      heading: 'Contact',
      body: 'Questions or requests about personal data: privacy@hydromart-digital.com.',
    },
  ],
};
