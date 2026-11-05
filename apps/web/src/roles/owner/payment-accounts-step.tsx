import {
  paymentAccountsSchema,
  paymentProviders,
  type PaymentAccount,
  type PaymentProvider,
} from '@buchi/shared';
import { useId, useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useSetPaymentAccounts } from './owner-api';
import { StepTitle } from './step-title';

const providerLabels: Record<PaymentProvider, string> = {
  telebirr: 'Telebirr',
  cbe_birr: 'CBE Birr',
  cbe_bank: 'CBE bank account',
};

const MAX_ACCOUNTS = 5;
const emptyAccount: PaymentAccount = { provider: 'telebirr', accountName: '', accountNumber: '' };

export function PaymentAccountsStep({
  shopId,
  saved,
}: {
  shopId: string;
  saved: PaymentAccount[];
}) {
  const [accounts, setAccounts] = useState(saved.length > 0 ? saved : [emptyAccount]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSetPaymentAccounts(shopId);

  const change = (index: number, patch: Partial<PaymentAccount>) => {
    setAccounts((list) =>
      list.map((account, i) => (i === index ? { ...account, ...patch } : account)),
    );
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const input = paymentAccountsSchema.safeParse(accounts);
    setErrors(input.success ? {} : fieldErrors(input.error));
    if (input.success) save.mutate(input.data);
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <StepTitle title="3. Payment accounts · የክፍያ መለያዎች" done={saved.length > 0} />
        <p className="text-sm text-muted-foreground">
          Customers pay into these. Buchi checks every receipt’s receiver against them.
        </p>
        {accounts.map((account, index) => (
          <AccountRow
            key={index}
            account={account}
            errors={errors}
            index={index}
            onChange={(patch) => {
              change(index, patch);
            }}
            onRemove={
              accounts.length > 1
                ? () => {
                    setAccounts((list) => list.filter((_, i) => i !== index));
                  }
                : undefined
            }
          />
        ))}
        {accounts.length < MAX_ACCOUNTS && (
          <Button
            variant="ghost"
            onClick={() => {
              setAccounts((list) => [...list, emptyAccount]);
            }}
          >
            + Add an account
          </Button>
        )}
        {save.isError && <Alert tone="error">{save.error.message}</Alert>}
        {save.isSuccess && <Alert tone="info">Payment accounts saved.</Alert>}
        <Button type="submit" disabled={save.isPending}>
          Save accounts
        </Button>
      </form>
    </Card>
  );
}

function AccountRow(props: {
  account: PaymentAccount;
  errors: Record<string, string>;
  index: number;
  onChange: (patch: Partial<PaymentAccount>) => void;
  onRemove: (() => void) | undefined;
}) {
  const { account, errors, index, onChange, onRemove } = props;
  const providerId = useId();
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">Account {index + 1}</legend>
      <label htmlFor={providerId} className="text-sm font-medium">
        Provider
      </label>
      <select
        id={providerId}
        className="min-h-11 rounded-lg border border-border bg-background px-3"
        value={account.provider}
        onChange={(e) => {
          const provider = paymentProviders.find((p) => p === e.target.value);
          if (provider) onChange({ provider });
        }}
      >
        {paymentProviders.map((provider) => (
          <option key={provider} value={provider}>
            {providerLabels[provider]}
          </option>
        ))}
      </select>
      <Field
        label="Account name"
        value={account.accountName}
        onChange={(e) => {
          onChange({ accountName: e.target.value });
        }}
        error={errors[`${String(index)}.accountName`]}
      />
      <Field
        label="Account or phone number"
        inputMode="numeric"
        value={account.accountNumber}
        onChange={(e) => {
          onChange({ accountNumber: e.target.value });
        }}
        error={errors[`${String(index)}.accountNumber`]}
      />
      {onRemove && (
        <Button variant="destructive" size="sm" onClick={onRemove}>
          Remove
        </Button>
      )}
    </fieldset>
  );
}
