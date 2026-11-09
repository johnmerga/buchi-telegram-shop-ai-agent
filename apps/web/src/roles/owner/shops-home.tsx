import { createShopSchema } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { QueryView } from '../../components/query-view';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { LanguageButton } from '../../components/language-button';
import { fieldErrors } from '../../lib/form';
import { useT } from '../../lib/i18n';
import { useCreateShop, useShops } from './owner-api';

/** Opens the owner's only shop directly, lets an owner of several pick one, or creates the first. */
export function ShopsHome() {
  const shops = useShops();
  const { t } = useT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('shops.title')}</h1>
        <LanguageButton />
      </div>
      <QueryView query={shops}>
        {(list) => {
          const [only] = list;
          if (list.length === 1 && only) return <Navigate to={`shops/${only.id}`} replace />;
          return (
            <>
              {list.map((shop) => (
                <Link
                  key={shop.id}
                  to={`shops/${shop.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 font-medium transition-colors hover:bg-muted"
                >
                  {shop.name}
                </Link>
              ))}
              <CreateShopForm firstShop={list.length === 0} />
            </>
          );
        }}
      </QueryView>
    </main>
  );
}

function CreateShopForm({ firstShop }: { firstShop: boolean }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const create = useCreateShop();
  const navigate = useNavigate();
  const { t } = useT();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const input = createShopSchema.safeParse({ name });
    if (!input.success) {
      setError(fieldErrors(input.error).name);
      return;
    }
    create.mutate(input.data, {
      onSuccess: ({ id }) => void navigate(`shops/${id}/setup`),
    });
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <CardTitle>{firstShop ? t('shops.openFirst') : t('shops.addAnother')}</CardTitle>
        {firstShop && <p className="text-sm text-muted-foreground">{t('shops.firstHint')}</p>}
        <Field
          label={t('shops.name')}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          error={error}
          autoComplete="organization"
        />
        {create.isError && <Alert tone="error">{create.error.message}</Alert>}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t('shops.creating') : t('shops.create')}
        </Button>
      </form>
    </Card>
  );
}
