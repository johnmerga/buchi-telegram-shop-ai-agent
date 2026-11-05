import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Alert({ tone, children }: { tone: 'info' | 'error'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-lg border p-3 text-sm',
        tone === 'error' ? 'border-destructive text-destructive' : 'border-border bg-muted',
      )}
    >
      {children}
    </div>
  );
}
