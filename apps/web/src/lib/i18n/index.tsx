import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { telegramWebApp } from '../telegram';
import { am } from './am';
import { en, type MessageKey } from './en';

export type Lang = 'en' | 'am';
export type { MessageKey };
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, am };
const storageKey = 'buchi.lang';

/** Fills `{name}` marks with their values. */
export function translate(
  lang: Lang,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const text = dictionaries[lang][key];
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (mark, name: string) =>
    name in values ? String(values[name]) : mark,
  );
}

function savedLanguage(): Lang | undefined {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === 'en' || saved === 'am' ? saved : undefined;
  } catch {
    return undefined;
  }
}

/** The saved choice, else Amharic for a Telegram user whose app is in Amharic, else English. */
export function initialLanguage(): Lang {
  const saved = savedLanguage();
  if (saved) return saved;
  const code = telegramWebApp()?.initDataUnsafe?.user?.language_code;
  return code?.toLowerCase().startsWith('am') ? 'am' : 'en';
}

const timeFormats: Record<Lang, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Addis_Ababa',
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
  am: new Intl.DateTimeFormat('am-ET', {
    timeZone: 'Africa/Addis_Ababa',
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
};

interface Language {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
  /** A time in Addis Ababa time, whatever the device's time zone, in the chosen language. */
  formatTime: (iso: string) => string;
}

const LanguageContext = createContext<Language | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Private mode or blocked storage: the choice lasts until the Mini App closes.
    }
    setLangState(next);
  }, []);

  const value = useMemo<Language>(
    () => ({
      lang,
      setLang,
      t: (key, values) => translate(lang, key, values),
      formatTime: (iso) => timeFormats[lang].format(new Date(iso)),
    }),
    [lang, setLang],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useT(): Language {
  const language = useContext(LanguageContext);
  if (!language) throw new Error('useT needs a LanguageProvider above it');
  return language;
}
