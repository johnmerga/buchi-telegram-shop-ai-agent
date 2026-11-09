import { Link } from 'react-router';
import { ChevronIcon } from '../../components/icons';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { moreSections } from './sections';

/** Every section that does not fit in the bottom bar, each with a line on what it is for. */
export default function MoreScreen() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('nav.more')}</h2>
      <ul className="flex flex-col gap-2">
        {moreSections.map((item, index) => (
          <li key={item.to}>
            <Link
              to={`../${item.to}`}
              relative="path"
              className={cn(
                'flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted',
                index === 0 && 'border-primary/40 bg-primary/5',
              )}
            >
              <span
                className={cn(
                  'grid size-11 shrink-0 place-items-center rounded-xl',
                  index === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                )}
              >
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t(item.label)}</span>
                <span className="block text-sm text-muted-foreground">{t(item.description)}</span>
              </span>
              <ChevronIcon className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
