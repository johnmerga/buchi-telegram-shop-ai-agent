import { useState } from 'react';
import { formatBirr, type ProductWithVariants } from '@buchi/shared';
import { Link } from 'react-router';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { usePostToChannel, useProducts, useRemoveProduct, useRestoreProduct } from './owner-api';
import { useShopId } from './use-shop-id';

/** Newest first, and only the products whose title, description, sizes, or colours hold every typed word. */
export function arrangeProducts(
  list: ProductWithVariants[],
  search: string,
): ProductWithVariants[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (product: ProductWithVariants) => {
    const text = [
      product.title,
      product.description,
      ...product.variants.flatMap((variant) => [variant.size, variant.color ?? '']),
    ]
      .join(' ')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  };
  return list.filter(matches).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export default function InventoryScreen() {
  const shopId = useShopId();
  const products = useProducts(shopId);
  const [search, setSearch] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Inventory · ዕቃዎች</h2>
        <Link
          to="new"
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          + New product
        </Link>
      </div>
      <QueryView query={products}>
        {(list) => {
          const shown = arrangeProducts(list, search);
          const onSale = shown.filter((product) => product.active);
          const removed = shown.filter((product) => !product.active);
          const searching = search.trim() !== '';
          return (
            <>
              {list.length > 0 && (
                <Field
                  label="Search products · ፈልግ"
                  type="search"
                  placeholder="Name, size, or colour"
                  autoComplete="off"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                />
              )}
              {onSale.length === 0 && searching ? (
                <EmptyState title="No match · አልተገኘም">
                  No product on sale matches “{search.trim()}”.
                </EmptyState>
              ) : onSale.length === 0 ? (
                <EmptyState title="No products yet · ገና ዕቃ የለም">
                  Add a product with its sizes and stock, then post it to your channel.
                </EmptyState>
              ) : (
                onSale.map((product) => (
                  <ProductCard key={product.id} shopId={shopId} product={product} />
                ))
              )}
              {removed.length > 0 && <RemovedProducts shopId={shopId} products={removed} />}
            </>
          );
        }}
      </QueryView>
    </div>
  );
}

function ProductCard({ shopId, product }: { shopId: string; product: ProductWithVariants }) {
  const post = usePostToChannel(shopId);
  const [confirming, setConfirming] = useState(false);
  const negotiable = product.pricingMode === 'negotiable';
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{product.title}</p>
        <Badge tone={negotiable ? 'primary' : 'neutral'}>
          {negotiable ? 'Negotiable · ድርድር' : 'Fixed price'}
        </Badge>
      </div>
      <p className="text-sm">
        {negotiable
          ? `Asking ${formatBirr(product.price)} in chat · lowest ${formatBirr(product.lowestPrice ?? product.price)}, never shown to customers`
          : formatBirr(product.price)}
      </p>
      {product.variants.length === 0 ? (
        <p className="text-sm text-destructive">No sizes yet: customers cannot buy it.</p>
      ) : (
        <ul className="flex flex-wrap gap-1 text-xs" aria-label="Sizes and stock">
          {product.variants.map((variant) => (
            <li key={variant.id}>
              <Badge>
                {variant.size}
                {variant.color ? ` ${variant.color}` : ''} · {variant.stock - variant.reserved} free
                {variant.reserved > 0 ? `, ${String(variant.reserved)} held` : ''}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {post.isError && <Alert tone="error">{post.error.message}</Alert>}
      {post.isSuccess && <Alert tone="info">Posted to your channel.</Alert>}
      <div className="flex gap-2">
        <Link
          to={product.id}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium"
        >
          Edit
        </Link>
        <Button
          className="flex-1"
          disabled={post.isPending || product.variants.length === 0}
          onClick={() => {
            post.mutate(product.id);
          }}
        >
          {post.isPending ? 'Posting…' : 'Post to channel'}
        </Button>
      </div>
      {confirming ? (
        <RemoveConfirm
          shopId={shopId}
          product={product}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-destructive"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Remove · አስወግድ
        </Button>
      )}
    </Card>
  );
}

/** An in-place confirmation, because removing hides the product from customers at once. */
function RemoveConfirm({
  shopId,
  product,
  onCancel,
}: {
  shopId: string;
  product: ProductWithVariants;
  onCancel: () => void;
}) {
  const remove = useRemoveProduct(shopId);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive p-3">
      <p className="text-sm">
        Remove <b>{product.title}</b>? Customers can no longer find or buy it, and its channel posts
        answer that it is no longer available. If past orders include it, it is hidden instead of
        erased, so those orders keep it, and you can restore it later.
      </p>
      {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Keep it
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate(product.id);
          }}
        >
          {remove.isPending ? 'Removing…' : 'Remove'}
        </Button>
      </div>
    </div>
  );
}

/** Products with past orders that the owner removed. They stay so those orders keep their item. */
function RemovedProducts({
  shopId,
  products,
}: {
  shopId: string;
  products: ProductWithVariants[];
}) {
  const restore = useRestoreProduct(shopId);
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Removed products · የተወገዱ ({products.length})
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Hidden from customers. Past orders still show them.
      </p>
      {restore.isError && <Alert tone="error">{restore.error.message}</Alert>}
      <ul className="mt-2 flex flex-col gap-2">
        {products.map((product) => (
          <li key={product.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm">{product.title}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={restore.isPending}
              onClick={() => {
                restore.mutate(product.id);
              }}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
