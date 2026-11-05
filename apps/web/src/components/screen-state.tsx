import type { ReactNode } from 'react';
import { ApiError } from '../lib/api-error';
import { Button } from './ui/button';
import { Card } from './ui/card';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="p-6 text-center text-sm text-muted-foreground">
      {label}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
    </Card>
  );
}

/** Shown for a 403: the screen renders no data at all, only this message. */
export function NotAllowed() {
  return (
    <Card role="alert" className="text-center">
      <p className="text-lg font-semibold">Not allowed · አልተፈቀደም</p>
      <p className="mt-2 text-sm text-muted-foreground">
        This page is for the shop’s owner. Open Buchi from the account that owns the shop.
      </p>
    </Card>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.code === 'FORBIDDEN') return <NotAllowed />;
  const message = error instanceof ApiError ? error.message : 'Check your connection and retry.';
  return (
    <Card role="alert" className="text-center">
      <p className="font-medium text-destructive">Something went wrong · ችግር ተፈጥሯል</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" className="mt-3" onClick={onRetry}>
          Retry · እንደገና
        </Button>
      )}
    </Card>
  );
}
