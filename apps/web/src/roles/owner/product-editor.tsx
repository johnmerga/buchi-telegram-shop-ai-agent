import {
  productInputSchema,
  variantsInputSchema,
  type PricingMode,
  type ProductWithVariants,
} from '@buchi/shared';
import { useCallback, useState, type SubmitEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { QueryView } from '../../components/query-view';
import { useBackButton } from '../../components/telegram-buttons';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useT } from '../../lib/i18n';
import { useProducts, useSaveProduct } from './owner-api';
import { ProductPhotos } from './product-photos';
import { useShopId } from './use-shop-id';
import { VariantsEditor, type VariantDraft } from './variants-editor';

export default function ProductEditor() {
  const shopId = useShopId();
  const { productId } = useParams();
  const products = useProducts(shopId);
  const navigate = useNavigate();
  const { t } = useT();
  useBackButton(useCallback(() => void navigate('..', { relative: 'path' }), [navigate]));

  return (
    <QueryView query={products}>
      {(list) => {
        const product = list.find((p) => p.id === productId);
        if (productId && !product) return <Alert tone="error">{t('product.gone')}</Alert>;
        return <ProductForm key={productId ?? 'new'} shopId={shopId} product={product} />;
      }}
    </QueryView>
  );
}

function ProductForm({
  shopId,
  product,
}: {
  shopId: string;
  product?: ProductWithVariants | undefined;
}) {
  const [title, setTitle] = useState(product?.title ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [pricingMode, setPricingMode] = useState<PricingMode>(product?.pricingMode ?? 'fixed');
  const [price, setPrice] = useState(product?.price ?? '');
  const [lowestPrice, setLowestPrice] = useState(product?.lowestPrice ?? '');
  const [variants, setVariants] = useState<VariantDraft[]>(
    product?.variants.map((v) => ({
      size: v.size,
      color: v.color ?? '',
      stock: String(v.stock),
    })) ?? [{ size: '', color: '', stock: '1' }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveProduct(shopId, product?.id);
  const navigate = useNavigate();
  const { t } = useT();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const productInput = productInputSchema.safeParse(
      pricingMode === 'fixed'
        ? { title, description, pricingMode, price }
        : { title, description, pricingMode, price, lowestPrice },
    );
    const variantsInput = variantsInputSchema.safeParse(
      variants.map((v) => ({
        size: v.size,
        color: v.color.trim() || null,
        stock: Number(v.stock),
      })),
    );
    setErrors({
      ...(productInput.success ? {} : fieldErrors(productInput.error)),
      ...(variantsInput.success ? {} : prefixed('variants', fieldErrors(variantsInput.error))),
    });
    if (!productInput.success || !variantsInput.success) return;
    save.mutate(
      { product: productInput.data, variants: variantsInput.data },
      { onSuccess: () => void navigate('..', { relative: 'path' }) },
    );
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <h2 className="text-lg font-semibold">{product ? t('product.edit') : t('product.new')}</h2>
        <Field
          label={t('product.title')}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          error={errors.title}
        />
        <Field
          label={t('product.description')}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
          error={errors.description}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t('product.pricing')}</legend>
          {(['fixed', 'negotiable'] as const).map((mode) => (
            <label
              key={mode}
              className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm has-checked:border-primary has-checked:bg-primary/5"
            >
              <input
                type="radio"
                name="pricingMode"
                value={mode}
                checked={pricingMode === mode}
                onChange={() => {
                  setPricingMode(mode);
                }}
              />
              {mode === 'fixed' ? t('product.fixedMode') : t('product.negotiableMode')}
            </label>
          ))}
        </fieldset>
        <Field
          label={pricingMode === 'fixed' ? t('product.price') : t('product.askingPrice')}
          inputMode="decimal"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
          }}
          error={errors.price}
        />
        {pricingMode === 'negotiable' && (
          <Field
            label={t('product.lowestPrice')}
            hint={t('product.lowestHint')}
            inputMode="decimal"
            value={lowestPrice}
            onChange={(e) => {
              setLowestPrice(e.target.value);
            }}
            error={errors.lowestPrice}
          />
        )}
        {product && (
          <ProductPhotos
            shopId={shopId}
            productId={product.id}
            count={product.photoFileIds.length}
          />
        )}
        <VariantsEditor
          variants={variants}
          savedCount={product?.variants.length ?? 0}
          onChange={setVariants}
          errors={errors}
        />
        {save.isError && <Alert tone="error">{save.error.message}</Alert>}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('product.save')}
        </Button>
      </form>
    </Card>
  );
}

function prefixed(prefix: string, errors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors).map(([key, message]) => [`${prefix}.${key}`, message]),
  );
}
