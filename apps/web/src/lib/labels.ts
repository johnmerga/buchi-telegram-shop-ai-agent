import type { DeliveryType, OrderStatus } from '@buchi/shared';

/** English with the Amharic the bot uses, so owners see the same words in both places. */
export const statusLabels: Record<OrderStatus, string> = {
  quoting: 'Quoting · ዋጋ በመጠየቅ',
  awaiting_payment: 'Awaiting payment · ክፍያ በመጠበቅ',
  verifying: 'Verifying · በማረጋገጥ',
  paid: 'Paid · ተከፍሏል',
  needs_review: 'Needs review · ግምገማ ያስፈልጋል',
  dispatching: 'Finding a driver · ሹፌር በመፈለግ',
  assigned: 'Driver assigned · ሹፌር ተመድቧል',
  out_for_delivery: 'On the way · በመንገድ ላይ',
  ready_for_pickup: 'Ready for pickup · ለመውሰድ ዝግጁ',
  delivered: 'Delivered · ደርሷል',
  expired: 'Expired · ጊዜው አልፏል',
  cancelled: 'Cancelled · ተሰርዟል',
};

export const deliveryLabels: Record<DeliveryType, string> = {
  free: 'Free delivery',
  express: 'Express',
  saver: 'Saver',
  far: 'Far area',
  pickup: 'Pickup',
};

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Addis_Ababa',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Times show in Addis Ababa time, whatever the device's time zone. */
export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}
