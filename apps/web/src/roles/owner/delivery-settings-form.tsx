import { deliverySettingsSchema, type DeliverySettings } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useT, type MessageKey } from '../../lib/i18n';
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

const fields: {
  key: keyof DeliverySettings;
  label: MessageKey;
  hint?: MessageKey;
  numeric: boolean;
}[] = [
  { key: 'baseFee', label: 'deliverySettings.baseFee', numeric: false },
  { key: 'ratePerKm', label: 'deliverySettings.ratePerKm', numeric: false },
  { key: 'ratePerMinute', label: 'deliverySettings.ratePerMinute', numeric: false },
  { key: 'freeRadiusKm', label: 'deliverySettings.freeRadius', numeric: true },
  { key: 'standardRangeKm', label: 'deliverySettings.standardRange', numeric: true },
  {
    key: 'farRangeKm',
    label: 'deliverySettings.farRange',
    hint: 'deliverySettings.farRangeHint',
    numeric: true,
  },
  {
    key: 'farCap',
    label: 'deliverySettings.farCap',
    hint: 'deliverySettings.farCapHint',
    numeric: false,
  },
  { key: 'saverDiscountPercent', label: 'deliverySettings.saverDiscount', numeric: true },
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
  const { t } = useT();

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
        <CardTitle>{t('deliverySettings.title')}</CardTitle>
        {!saved && <Alert tone="info">{t('deliverySettings.unsaved')}</Alert>}
        <p className="text-sm text-muted-foreground">{t('deliverySettings.formula')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(({ key, label, hint }) => (
            <Field
              key={key}
              label={t(label)}
              {...(hint ? { hint: t(hint) } : {})}
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
        {save.isSuccess && <Alert tone="info">{t('deliverySettings.saved')}</Alert>}
        <Button type="submit" disabled={save.isPending}>
          {t('deliverySettings.save')}
        </Button>
      </form>
    </Card>
  );
}
