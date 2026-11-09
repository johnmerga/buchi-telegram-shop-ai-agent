import { Badge } from '../../components/ui/badge';
import { CardTitle } from '../../components/ui/card';
import { useT } from '../../lib/i18n';

export function StepTitle({ title, done }: { title: string; done: boolean }) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-between gap-2">
      <CardTitle>{title}</CardTitle>
      {done ? <Badge tone="primary">{t('setup.done')}</Badge> : <Badge>{t('setup.todo')}</Badge>}
    </div>
  );
}
