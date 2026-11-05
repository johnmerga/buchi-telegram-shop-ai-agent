import { useEffect, useMemo } from 'react';
import { useScreenshot } from './review-api';

/** The customer's payment screenshot, streamed from Telegram and shown from memory only. */
export function Screenshot({ shopId, proofId }: { shopId: string; proofId: string }) {
  const image = useScreenshot(shopId, proofId);
  const url = useMemo(() => image.data && URL.createObjectURL(image.data), [image.data]);

  // An object URL keeps the image in memory until it is revoked.
  useEffect(() => {
    if (url === undefined) return;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  if (image.isError) {
    return <p className="text-sm text-muted-foreground">The screenshot could not be loaded.</p>;
  }
  if (!url) return <p className="text-sm text-muted-foreground">Loading the screenshot…</p>;
  return (
    <img
      src={url}
      alt="Payment screenshot"
      className="max-h-96 w-full rounded-lg border border-border object-contain"
    />
  );
}
