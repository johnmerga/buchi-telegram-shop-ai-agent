import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';

/** A size row as typed, before the shared schema turns stock into a number. */
export interface VariantDraft {
  size: string;
  color: string;
  stock: string;
}

const MAX_VARIANTS = 50;

/**
 * The first `savedCount` rows are saved sizes. The server keeps a saved size, so its size and
 * colour are fixed here, and selling it out means stock 0.
 */
export function VariantsEditor({
  variants,
  savedCount,
  onChange,
  errors,
}: {
  variants: VariantDraft[];
  savedCount: number;
  onChange: (variants: VariantDraft[]) => void;
  errors: Record<string, string>;
}) {
  const update = (index: number, patch: Partial<VariantDraft>) => {
    onChange(variants.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)));
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Sizes and stock · መጠንና ብዛት</legend>
      {savedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          To stop selling a saved size, set its stock to 0.
        </p>
      )}
      {errors.variants && <p className="text-xs text-destructive">{errors.variants}</p>}
      {variants.map((variant, index) => {
        const error = (field: string) => errors[`variants.${String(index)}.${field}`];
        return (
          <div key={index} className="grid grid-cols-[1fr_1fr_5rem] items-start gap-2">
            <Field
              label="Size"
              value={variant.size}
              readOnly={index < savedCount}
              onChange={(e) => {
                update(index, { size: e.target.value });
              }}
              error={error('size')}
            />
            <Field
              label="Colour"
              value={variant.color}
              readOnly={index < savedCount}
              onChange={(e) => {
                update(index, { color: e.target.value });
              }}
              error={error('color')}
            />
            <Field
              label="Stock"
              inputMode="numeric"
              value={variant.stock}
              onChange={(e) => {
                update(index, { stock: e.target.value });
              }}
              error={error('stock')}
            />
          </div>
        );
      })}
      <div className="flex gap-2">
        {variants.length < MAX_VARIANTS && (
          <Button
            variant="ghost"
            onClick={() => {
              onChange([...variants, { size: '', color: '', stock: '1' }]);
            }}
          >
            + Add a size
          </Button>
        )}
        {variants.length > Math.max(1, savedCount) && (
          <Button
            variant="ghost"
            onClick={() => {
              onChange(variants.slice(0, -1));
            }}
          >
            Remove the last new size
          </Button>
        )}
      </div>
    </fieldset>
  );
}
