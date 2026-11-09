import type { ReactNode } from 'react';
import { ApiError } from '../lib/api-error';
import { useT } from '../lib/i18n';
import { Button } from './ui/button';
import { Card } from './ui/card';

export function Loading({ label }: { label?: string }) {
  const { t } = useT();
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 p-8 text-sm text-muted-foreground"
    >
      <span className="size-6 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" />
      {label ?? t('common.loading')}
    </div>
  );
}

export function EmptyState({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 py-8 text-center">
      {icon && (
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </span>
      )}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </Card>
  );
}

/** Shown for a 403: the screen renders no data at all, only this message. */
export function NotAllowed() {
  const { t } = useT();
  return (
    <Card role="alert" className="text-center">
      <p className="text-lg font-semibold">{t('common.notAllowed')}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t('common.notAllowedBody')}</p>
    </Card>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useT();
  if (error instanceof ApiError && error.code === 'FORBIDDEN') return <NotAllowed />;
  const message = error instanceof ApiError ? error.message : t('common.checkConnection');
  return (
    <Card role="alert" className="text-center">
      <p className="font-medium text-destructive">{t('common.error')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" className="mt-3" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </Card>
  );
}
