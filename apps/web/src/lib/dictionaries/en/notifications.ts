// Notifications inbox (spec 5h). Mirrors id/notifications.ts.
export const notifications = {
  title: 'Notifications',
  markRead: 'Mark read',
  emptyTitle: 'No notifications',
  emptyBody: 'Order updates & promos will show up here.',
  events: {
    ORDER_RECEIVED: 'Order received',
    ORDER_CONFIRMED: 'Order confirmed',
    ORDER_ON_DELIVERY: 'Order on the way',
    ORDER_DELIVERED: 'Order delivered',
    ORDER_COMPLETED: 'Order completed',
    ORDER_CANCELLED: 'Order cancelled',
    CUSTOMER_REGISTERED: 'Welcome to Hydromart',
    STOCK_LOW: 'Low stock',
    POINTS_EARNED: 'Points earned',
    VOUCHER_GRANTED: 'New voucher',
    REORDER_REMINDER: 'Time to refill?',
  },
};
