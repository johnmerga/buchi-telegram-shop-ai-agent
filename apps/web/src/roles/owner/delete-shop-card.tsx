import { useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { useDeleteShop } from './owner-api';

/** Removes the shop for good, once the owner types its name again. */
export function DeleteShopCard({ shopId, name }: { shopId: string; name: string }) {
  const [typed, setTyped] = useState('');
  const remove = useDeleteShop(shopId);
  const navigate = useNavigate();
  const matches = typed.trim() === name.trim();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!matches) return;
    remove.mutate(typed, { onSuccess: () => void navigate('/', { replace: true }) });
  };

  return (
    <Card className="border-destructive">
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <CardTitle>Delete shop · ሱቁን ሰርዝ</CardTitle>
        <p className="text-sm text-muted-foreground">
          This removes <b>{name}</b> and everything in it for good: products, customers, orders,
          payments, deliveries, drivers, and the AI's records. The channel itself stays on Telegram.
        </p>
        <Field
          label="Type the shop's name to confirm"
          value={typed}
          autoComplete="off"
          onChange={(e) => {
            setTyped(e.target.value);
          }}
        />
        {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}
        <Button type="submit" variant="destructive" disabled={!matches || remove.isPending}>
          {remove.isPending ? 'Deleting…' : 'Delete this shop'}
        </Button>
      </form>
    </Card>
  );
}
