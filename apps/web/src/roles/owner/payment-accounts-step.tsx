import { paymentAccountsSchema, paymentProviders, type PaymentAccount } from '@buchi/shared';
import { useId, useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useT } from '../../lib/i18n';
import { useSetPaymentAccounts } from './owner-api';
import { StepTitle } from './step-title';

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
  const { t } = useT();

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
        <StepTitle title={t('setup.accounts')} done={saved.length > 0} />
        <p className="text-sm text-muted-foreground">{t('setup.accountsHint')}</p>
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
            {t('setup.addAccount')}
          </Button>
        )}
        {save.isError && <Alert tone="error">{save.error.message}</Alert>}
        {save.isSuccess && <Alert tone="info">{t('setup.accountsSaved')}</Alert>}
        <Button type="submit" disabled={save.isPending}>
          {t('setup.saveAccounts')}
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
  const { t } = useT();
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">
        {t('setup.account', { number: index + 1 })}
      </legend>
      <label htmlFor={providerId} className="text-sm font-medium">
        {t('setup.provider')}
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
            {t(`provider.${provider}`)}
          </option>
        ))}
      </select>
      <Field
        label={t('setup.accountName')}
        value={account.accountName}
        onChange={(e) => {
          onChange({ accountName: e.target.value });
        }}
        error={errors[`${String(index)}.accountName`]}
      />
      <Field
        label={t('setup.accountNumber')}
        inputMode="numeric"
        value={account.accountNumber}
        onChange={(e) => {
          onChange({ accountNumber: e.target.value });
        }}
        error={errors[`${String(index)}.accountNumber`]}
      />
      {onRemove && (
        <Button variant="destructive" size="sm" onClick={onRemove}>
          {t('inventory.remove')}
        </Button>
      )}
    </fieldset>
  );
}
