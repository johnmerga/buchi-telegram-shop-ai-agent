import { useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { useT } from '../../lib/i18n';
import { useDeleteShop } from './owner-api';

/** Removes the shop for good, once the owner types its name again. */
export function DeleteShopCard({ shopId, name }: { shopId: string; name: string }) {
  const [typed, setTyped] = useState('');
  const remove = useDeleteShop(shopId);
  const navigate = useNavigate();
  const { t } = useT();
  const matches = typed.trim() === name.trim();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!matches) return;
    remove.mutate(typed, { onSuccess: () => void navigate('/', { replace: true }) });
  };

  return (
    <Card className="border-destructive">
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <CardTitle>{t('deleteShop.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('deleteShop.hint', { name })}</p>
        <Field
          label={t('deleteShop.confirm')}
          value={typed}
          autoComplete="off"
          onChange={(e) => {
            setTyped(e.target.value);
          }}
        />
        {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}
        <Button type="submit" variant="destructive" disabled={!matches || remove.isPending}>
          {remove.isPending ? t('deleteShop.deleting') : t('deleteShop.delete')}
        </Button>
      </form>
    </Card>
  );
}
