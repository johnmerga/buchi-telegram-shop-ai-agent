import { deliverySettingsSchema, type DeliverySettings } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useSaveDeliverySettings } from './owner-api';

type Draft = Record<keyof DeliverySettings, string>;

/** The design doc's example values, so a new shop starts from sensible prices. */
const suggested: Draft = {
  baseFee: '50',
  ratePerKm: '15',
  ratePerMinute: '2',
  freeRadiusKm: '3',
  standardRangeKm: '8',
  farRangeKm: '20',
  farCap: '1000',
  saverDiscountPercent: '20',
};

const fields: { key: keyof DeliverySettings; label: string; hint?: string; numeric: boolean }[] = [
  { key: 'baseFee', label: 'Base fee (birr)', numeric: false },
  { key: 'ratePerKm', label: 'Rate per km (birr)', numeric: false },
  { key: 'ratePerMinute', label: 'Rate per minute (birr)', numeric: false },
  { key: 'freeRadiusKm', label: 'Free delivery up to (km)', numeric: true },
  { key: 'standardRangeKm', label: 'Express and Saver up to (km)', numeric: true },
  {
    key: 'farRangeKm',
    label: 'Far-area quotes up to (km)',
    hint: 'Beyond this, customers pick up at the shop.',
    numeric: true,
  },
  {
    key: 'farCap',
    label: 'Far-area price cap (birr)',
    hint: 'Above it, you approve the price yourself.',
    numeric: false,
  },
  { key: 'saverDiscountPercent', label: 'Saver discount (%)', numeric: true },
];

function toDraft(settings: DeliverySettings): Draft {
  return {
    baseFee: settings.baseFee,
    ratePerKm: settings.ratePerKm,
    ratePerMinute: settings.ratePerMinute,
    freeRadiusKm: String(settings.freeRadiusKm),
    standardRangeKm: String(settings.standardRangeKm),
    farRangeKm: String(settings.farRangeKm),
    farCap: settings.farCap,
    saverDiscountPercent: String(settings.saverDiscountPercent),
  };
}

export function DeliverySettingsForm({
  shopId,
  saved,
}: {
  shopId: string;
  saved: DeliverySettings | null;
}) {
  const [draft, setDraft] = useState<Draft>(saved ? toDraft(saved) : suggested);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveDeliverySettings(shopId);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const values = Object.fromEntries(
      fields.map(({ key, numeric }) => [key, numeric ? Number(draft[key]) : draft[key].trim()]),
    );
    const input = deliverySettingsSchema.safeParse(values);
    setErrors(input.success ? {} : fieldErrors(input.error));
    if (input.success) save.mutate(input.data);
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <CardTitle>Delivery prices · የማድረሻ ዋጋ</CardTitle>
        {!saved && (
          <Alert tone="info">
            Your shop offers pickup only until you save these. The values below are suggestions.
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          Driver payout = base fee + rate per km × road km + rate per minute × minutes. Express is
          the payout rounded up to 10 birr; Saver takes the discount off.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(({ key, label, hint }) => (
            <Field
              key={key}
              label={label}
              {...(hint ? { hint } : {})}
              inputMode="decimal"
              value={draft[key]}
              onChange={(e) => {
                setDraft((d) => ({ ...d, [key]: e.target.value }));
              }}
              error={errors[key]}
            />
          ))}
        </div>
        {save.isError && <Alert tone="error">{save.error.message}</Alert>}
        {save.isSuccess && <Alert tone="info">Delivery prices saved.</Alert>}
        <Button type="submit" disabled={save.isPending}>
          Save delivery prices
        </Button>
      </form>
    </Card>
  );
}
