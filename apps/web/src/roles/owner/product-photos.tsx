import { MAX_PRODUCT_PHOTO_BYTES, productPhotoTypes } from '@buchi/shared';
import { useState, type ChangeEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { useT } from '../../lib/i18n';
import { useAddPhoto, useProductPhoto } from './owner-api';
import { useObjectUrl } from './use-object-url';

/**
 * A saved product's photos, streamed from Telegram, and an upload for more. Each photo goes
 * through the owner's bot chat, where photos sent to the bot are kept too.
 */
export function ProductPhotos({
  shopId,
  productId,
  count,
}: {
  shopId: string;
  productId: string;
  count: number;
}) {
  const add = useAddPhoto(shopId, productId);
  const [invalid, setInvalid] = useState<string>();
  const { t } = useT();

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const photo = event.target.files?.[0];
    event.target.value = '';
    if (!photo) return;
    const usable = productPhotoTypes.includes(photo.type) && photo.size <= MAX_PRODUCT_PHOTO_BYTES;
    setInvalid(usable ? undefined : t('photos.invalid'));
    if (usable) add.mutate(photo);
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{t('photos.title')}</legend>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{t('photos.none')}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2" aria-label={t('photos.list')}>
          {Array.from({ length: count }, (_, index) => (
            <li key={index}>
              <Thumbnail shopId={shopId} productId={productId} index={index} />
            </li>
          ))}
        </ul>
      )}
      <label className="inline-flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-border px-4 text-sm font-medium">
        {add.isPending ? t('photos.adding') : t('photos.add')}
        <input
          type="file"
          accept={productPhotoTypes.join(',')}
          className="sr-only"
          disabled={add.isPending}
          onChange={choose}
        />
      </label>
      {invalid && <Alert tone="error">{invalid}</Alert>}
      {add.isError && <Alert tone="error">{add.error.message}</Alert>}
    </fieldset>
  );
}

function Thumbnail({
  shopId,
  productId,
  index,
}: {
  shopId: string;
  productId: string;
  index: number;
}) {
  const image = useProductPhoto(shopId, productId, index);
  const url = useObjectUrl(image.data);
  const { t } = useT();
  const label = t('photos.photo', { number: index + 1 });
  if (!url) {
    return (
      <div
        role="img"
        aria-label={image.isError ? t('photos.failed', { label }) : t('photos.loading', { label })}
        className="aspect-square rounded-lg border border-border bg-muted"
      />
    );
  }
  return (
    <img
      src={url}
      alt={label}
      className="aspect-square w-full rounded-lg border border-border object-cover"
    />
  );
}
