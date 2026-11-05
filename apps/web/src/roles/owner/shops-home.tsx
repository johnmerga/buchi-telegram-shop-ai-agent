import { createShopSchema } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { QueryView } from '../../components/query-view';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useCreateShop, useShops } from './owner-api';

/** Opens the owner's only shop directly, lets an owner of several pick one, or creates the first. */
export function ShopsHome() {
  const shops = useShops();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Your shops · ሱቆችዎ</h1>
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
                  className="rounded-xl border border-border bg-card p-4 font-medium"
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
        <CardTitle>{firstShop ? 'Open your shop · ሱቅ ይክፈቱ' : 'Add another shop'}</CardTitle>
        {firstShop && (
          <p className="text-sm text-muted-foreground">
            You do not own a shop on Buchi yet. Name your shop to start.
          </p>
        )}
        <Field
          label="Shop name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          error={error}
          autoComplete="organization"
        />
        {create.isError && <Alert tone="error">{create.error.message}</Alert>}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create shop'}
        </Button>
      </form>
    </Card>
  );
}
