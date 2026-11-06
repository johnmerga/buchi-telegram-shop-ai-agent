import { useEffect, useMemo } from 'react';

/** An object URL for an image kept in memory, revoked when the image changes or the page leaves. */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const url = useMemo(() => blob && URL.createObjectURL(blob), [blob]);
  useEffect(() => {
    if (url === undefined) return;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}
