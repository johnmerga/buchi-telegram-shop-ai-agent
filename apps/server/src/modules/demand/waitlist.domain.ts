import { addisClockTime } from '../../shared/time';

export function restockNotice(item: { title: string; size: string; heldUntil: Date }): string {
  return [
    `🔔 ${item.title} · መጠን / size ${item.size} ተመልሷል / is back in stock!`,
    `አንድ ይዤልዎታለሁ / I am holding one for you until ${addisClockTime(item.heldUntil)}. Tap your size below to order it.`,
  ].join('\n');
}

export function similarArrivedNotice(title: string): string {
  return `🔔 የጠየቁት የሚመስል ደርሷል / Something like the product you asked about just arrived: ${title}`;
}
