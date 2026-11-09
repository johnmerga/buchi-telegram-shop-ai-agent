import { useT } from '../lib/i18n';

/** A round button that switches the Mini App between English and Amharic. */
export function LanguageButton() {
  const { lang, setLang, t } = useT();
  const next = lang === 'en' ? 'am' : 'en';
  return (
    <button
      type="button"
      onClick={() => {
        setLang(next);
      }}
      aria-label={t('language.switch')}
      title={t('language.switch')}
      className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span lang={lang}>{lang === 'en' ? 'EN' : 'አማ'}</span>
    </button>
  );
}
