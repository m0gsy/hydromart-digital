import { terms as base } from '../id/terms';

// English — mirrors the shape of id/terms.ts (the source of truth for keys and for meaning).
// Where the two disagree, the Indonesian text governs: it is the language the agreement is
// made in and the one a BPSK panel would read.
export const terms: typeof base = {
  title: 'Terms of Service',
  effective: 'In force since 29 August 2026',
  intro:
    'These terms govern your use of the Hydromart app and website. By registering or placing an order you agree to them. Read them together with our Privacy Policy, which explains what personal data we process and on what basis.',
  sections: [
    {
      heading: '1. Who we are and what we do',
      body: 'Hydromart is a platform that connects you with drinking-water depots near you. Those depots prepare, sell and deliver the water — some are owned by Hydromart, some by franchise partners. We provide the app, process your order, and set the standards a depot has to meet. We are not the party that produces the water.',
    },
    {
      heading: '2. Your account',
      body: 'An account is created with a phone number and verified by an OTP code. One number, one account. The OTP is the key to your account: never give it to anyone, including anyone claiming to be from Hydromart — we never ask for an OTP by phone, chat or message. You are responsible for activity from your account, and must tell us if your number changes hands. You can delete your account at any time from the Delete Account page.',
    },
    {
      heading: '3. Placing an order',
      body: 'Your order is an offer to buy, not a completed transaction. The depot serving your area accepts or declines it, and the order becomes binding once the depot confirms. A depot may decline — stock has run out, your address is outside its service radius, or it has closed for the day — and if that happens you are charged nothing.',
    },
    {
      heading: '4. Prices',
      body: 'Prices are set by the depot that will serve you, so the same product can cost different amounts at different depots. The price that applies is the one shown on the payment screen when you order, including delivery and any discount. We show prices in whole rupiah. If there is an obvious pricing error you ought to have noticed — a gallon for one hundred rupiah — we may cancel that order and refund you.',
    },
    {
      heading: '5. Payment',
      body: 'Payment is taken directly by the depot, not by Hydromart. We do not hold your money, we are not a payment intermediary, and we store no card details — we only record that payment happened. Which methods are available differs by depot: cash on delivery is always available, while bank transfer and QRIS appear only once that depot has registered its details. For cash, the courier records the amount you handed over and the change given.',
    },
    {
      heading: '6. Gallon deposit',
      body: 'For a gallon you borrow there is a deposit, paid up front and returned when you return the gallon intact. The deposit is not a rental fee and does not shrink with time. A gallon that is cracked, broken or lost does not earn its deposit back. The amount is shown before you pay.',
    },
    {
      heading: '7. Delivery',
      body: 'The delivery window is an estimate, not a promised hour — traffic, weather and depot queues all affect it. Make sure your address and landmark are correct; a wrong address is the commonest reason a delivery fails. The courier records the handover with a photo and may ask the recipient to sign. If nobody is there, the courier will contact you and the delivery can be rescheduled.',
    },
    {
      heading: '8. Cancelling, and when something is wrong',
      body: 'You can cancel before the depot starts preparing your order; after that, cancelling depends on the depot agreeing. If what you receive is not right — a broken seal, cloudy water, a short count — report it the same day through the app, with a photo if you have one. The depot will replace it or refund you. For a paid order that is cancelled, the depot refunds you by the same route you paid.',
    },
    {
      heading: '9. Points, membership tiers, vouchers and referrals',
      body: 'Points, membership tiers, vouchers and referral rewards are an appreciation programme, not money. None of them can be cashed out, transferred or sold. We may change earning rates, tier thresholds, discount amounts and validity periods, and will tell you through the app when a change is material. Points or rewards earned on an order that is later cancelled are taken back. Points earned by unfair means — fake orders, duplicate accounts, or abusing the referral programme — may be removed along with the account.',
    },
    {
      heading: '10. Subscriptions',
      body: 'A subscription schedules repeat orders for you automatically. The price that applies is the price at the time each order is created, not the price when you subscribed. You can skip one delivery, pause, or stop at any time in the app, and stopping applies to orders not yet created.',
    },
    {
      heading: '11. Agents and partners',
      body: 'If you are registered as an agent or franchise partner, that relationship is governed by the separate agreement you signed, and that agreement prevails where it differs from these terms. Agent pricing replaces membership discounts and vouchers rather than stacking with them.',
    },
    {
      heading: '12. What you may not do',
      body: 'Do not place orders you do not intend to buy, create accounts with someone else’s number, use the service to resell without an agent agreement, extract data from the app automatically, attempt to reach accounts or parts of the system that are not yours, or treat couriers and depot staff abusively. We may restrict or close accounts that do.',
    },
    {
      heading: '13. Availability',
      body: 'We work to keep the service running, but do not promise it will be uninterrupted. Maintenance, network faults and matters outside our control can make it temporarily unavailable. Depots also have their own opening hours and service areas, and may stop serving an area.',
    },
    {
      heading: '14. Our responsibility',
      body: 'We are responsible for loss caused by our own fault. For matters that are the depot’s responsibility — water quality, the condition of a gallon, delivery accuracy — we help resolve them and put you in touch with that depot. Nothing here reduces your rights as a consumer under Law No. 8 of 1999 on Consumer Protection, and any part of these terms that conflicts with those rights does not apply to the extent of the conflict.',
    },
    {
      heading: '15. Personal data',
      body: 'How we collect, use, keep and delete your personal data is set out in the Privacy Policy, including your rights under Law No. 27 of 2022 on Personal Data Protection. That policy forms part of these terms.',
    },
    {
      heading: '16. Changes to these terms',
      body: 'We may update these terms. When a change is material we will tell you through the app before it takes effect, and the "in force since" date above always shows the version that applies. If you do not agree with a new version you can stop using the service and delete your account.',
    },
    {
      heading: '17. Governing law and disputes',
      body: 'These terms are governed by the law of the Republic of Indonesia. If there is a dispute, contact us first — most are settled there. If not, it may be resolved by negotiation, by the Consumer Dispute Settlement Body (BPSK), or by a competent court, as you choose under applicable law.',
    },
    {
      heading: '18. Contacting us',
      body: 'Questions about these terms, complaints, or requests about your account can be sent through the Help menu in the app.',
    },
  ],
};
