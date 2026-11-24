import { privacy as base } from '../id/privacy';

// English — mirrors the shape of id/privacy.ts (the source of truth for keys).
export const privacy: typeof base = {
  effective: 'Effective 24 November 2026',
  intro:
    'Hydromart respects your privacy. This policy explains what personal data we collect, why, how long we keep it, and your rights under Indonesia’s Law No. 27 of 2022 on Personal Data Protection (UU PDP).',
  sections: [
    {
      heading: 'Promos and offers',
      body: 'If you have ordered from one of our depots, we occasionally send news about promotions from that depot — as a row in your in-app notification inbox, and as a device notification if you allowed one. The lawful basis is our legitimate interest in telling our own customers about a service they already use, not a separate marketing consent. You can stop it at any time under Account › Preferences › Promos & offers; it takes effect immediately and does not affect your order-status notifications. We do not sell or rent your data to third parties for their marketing.',
    },
    {
      heading: 'Data we collect',
      body: 'When you register and order: your name, phone number, email (optional), and delivery address. When an order is delivered, the courier captures proof of delivery — a hand-over photo, the recipient’s signature, the recipient’s name, and the GPS location and time of hand-over. If you open our site through a link or QR code that carries a campaign code (for example from an exhibition, a depot poster or an ad), that code is kept on your device and recorded with your signup or your franchise application. The code holds only the campaign’s name; it does not record which pages you opened.',
    },
    {
      heading: 'Device location',
      body: 'If you tap “Use my location” on the home screen, while saving an address, or at checkout, the app reads your device’s location — precise location (GPS) if allowed, so the courier finds the delivery point — and sends it to our servers to find the nearest depot and check its delivery range. The point is stored on your address and order. Location permission is optional: you can set the point yourself (coordinates or a Google Maps link). Location is read only when you tap, never in the background, is not shared with third parties or used for ads or analytics, is sent encrypted, and can be deleted on request with your account data.',
    },
    {
      heading: 'How we use it',
      body: 'Data is used to process and deliver your orders, verify hand-over (proof of delivery), provide customer support, run points & rewards, and meet legal obligations. Proof of delivery is the lawful record that an order was received. Campaign codes are used to measure which promotions actually bring in customers and prospective franchise partners.',
    },
    {
      heading: 'Legal basis & consent',
      body: 'We process data based on your consent (given at registration and when the recipient signs for a delivery) and to perform your order. You may withdraw consent at any time; as a result we may be unable to continue certain services.',
    },
    {
      heading: 'Sharing & third-party recipients',
      body: 'Your order data is shared with the depot and courier handling it. Beyond that, some providers receive part of your data because they are the ones processing it for us, and this is the complete list. (1) BiznetGio NEO Object Storage (Jakarta and West Java, Indonesia) holds image files, namely proof-of-delivery photos and signatures and your profile photo, and the backup copies of our database. Since this policy took effect, backup copies are encrypted before they leave our server, and BiznetGio does not hold the key that opens them; older copies that were not encrypted leave the backup list within 14 days and are deleted for good within about 45 days. (2) Zenziva (Indonesia) receives your phone number and the message text in order to send OTP codes by SMS. (3) Google, through Firebase Cloud Messaging, receives your Android device token together with the title and body of every notification we send — so a line like “Your order is on its way” does pass through Google’s servers, and Google processes it outside Indonesia. (4) For browser notifications, the push service of your browser vendor (Google for Chrome, Mozilla for Firefox, and so on) relays our message, but the content is encrypted, so they learn only which device it went to, not what it said. Device notifications run only if you allow them; withdrawing that permission stops both the token and the notification text from reaching Google. (5) Sentry (servers in Germany, EU) receives application error reports: the error message, the stack trace showing where in our code it happened, the app version, and the address of the page you were on with anything after the question mark removed. Session replay and breadcrumbs are switched off, so what is on your screen — your name, address, phone number — is not sent. Because the report is sent from your device, Sentry sees your IP address as the sender. This means some of your technical data is processed outside Indonesia. None of the recipients above may use your data for their own purposes, and we do not sell or rent your personal data.',
    },
    {
      heading: 'Storage & retention',
      body: 'Account data is kept while your account is active. Proof-of-delivery data (photo, signature, recipient name, location) is kept for at most 12 months after hand-over, then deleted automatically. Photo/signature files in object storage are removed by a bucket lifecycle rule on the same schedule. A payment-proof photo you upload when paying is kept for at most 12 months after the payment, after which the file is deleted from object storage — the payment record itself is retained as a financial record, without the photo. If you apply for a franchise partnership through the public form, the name, WhatsApp number, and proposed-site location you enter are kept so we can review that application; rejected applications are deleted at most 24 months after the decision. A campaign code on your device stays until you clear the site’s or the app’s data; one recorded with your account or application lasts as long as that account or application, and is removed when your account is deleted.',
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
