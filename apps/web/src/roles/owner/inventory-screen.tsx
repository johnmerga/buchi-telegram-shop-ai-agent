import { formatBirr, type ProductWithVariants } from '@buchi/shared';
import { Link } from 'react-router';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { usePostToChannel, useProducts } from './owner-api';
import { useShopId } from './use-shop-id';

export default function InventoryScreen() {
  const shopId = useShopId();
  const products = useProducts(shopId);
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
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No products yet · ገና ዕቃ የለም">
              Add a product with its sizes and stock, then post it to your channel.
            </EmptyState>
          ) : (
            list.map((product) => (
              <ProductCard key={product.id} shopId={shopId} product={product} />
            ))
          )
        }
      </QueryView>
    </div>
  );
}

function ProductCard({ shopId, product }: { shopId: string; product: ProductWithVariants }) {
  const post = usePostToChannel(shopId);
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
    </Card>
  );
}
