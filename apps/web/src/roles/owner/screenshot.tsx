import { useT } from '../../lib/i18n';
import { useScreenshot } from './review-api';
import { useObjectUrl } from './use-object-url';

/** The customer's payment screenshot, streamed from Telegram and shown from memory only. */
export function Screenshot({ shopId, proofId }: { shopId: string; proofId: string }) {
  const image = useScreenshot(shopId, proofId);
  const url = useObjectUrl(image.data);
  const { t } = useT();

  if (image.isError) {
    return <p className="text-sm text-muted-foreground">{t('screenshot.failed')}</p>;
  }
  if (!url) return <p className="text-sm text-muted-foreground">{t('screenshot.loading')}</p>;
  return (
    <img
      src={url}
      alt={t('screenshot.alt')}
      className="max-h-96 w-full rounded-lg border border-border object-contain"
    />
  );
}
