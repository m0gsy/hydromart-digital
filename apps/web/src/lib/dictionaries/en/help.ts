// Help (spec 10c): topics, FAQ (accordion), CS contact. Mirrors id/help.ts.
export const help = {
  complaints: {
    title: "My complaints",
    cta: "Raise a complaint",
    guest: "Sign in first so we can reply to you.",
    subject: "What went wrong",
    subjectHint: "For example: the gallon was leaking on arrival",
    orderRef: "Order number (optional)",
    orderRefHint: "Fill this in if the complaint is about one order",
    body: "Tell us what happened",
    send: "Send the complaint",
    sent: "Complaint sent. We will contact you on your account number.",
    sendError: "Could not send the complaint.",
    subjectRequired: "Say what went wrong first.",
    bodyRequired: "Tell us what happened first.",
    cancel: "Cancel",
    empty: "No complaints yet.",
    reply: "Hydromart replied",
    status: { OPEN: "Awaiting handling", ASSIGNED: "Being handled", RESOLVED: "Resolved" },
  },

  title: 'Help',
  searchPlaceholder: 'Search help…',
  topicsTitle: 'Topics',
  faqTitle: 'Common questions',
  noResults: 'No results for "{q}".',
  chatCta: 'Chat with support',
  callAria: 'Call support',
  topics: {
    delivery: 'Tracking & delivery issues',
    payment: 'Payments & refunds',
    gallon: 'Gallons, deposit & swap',
    account: 'Account & security',
  },
  faq: [
    {
      q: 'How do I swap an empty gallon?',
      a: 'When the courier arrives, hand over your empty gallon — they swap it for a full, sealed one. There is no swap fee as long as the gallon is in good condition.',
    },
    {
      q: 'How long do refunds take?',
      a: 'Refunds for non-cash payments (QRIS, e-wallet, VA) are processed within 1–3 business days back to the original source. A cancelled COD order is never charged.',
    },
    {
      q: 'Can I change the address after ordering?',
      a: 'While the depot has not started preparing your order, you can edit the address from the order tracking page. Once the courier departs, contact support to adjust.',
    },
    {
      q: 'What are points & membership tiers?',
      a: 'You earn 1 point per {amount} spent. Points redeem for vouchers/gifts, and your total points raise your tier (Silver → Gold → Platinum) for bigger discounts.',
    },
  ],
};
