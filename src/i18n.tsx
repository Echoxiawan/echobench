import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { normalizeLocale, systemLocale, translate, type Locale } from './messages';

const STORAGE_KEY = 'echobench:locale';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (source: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  if (typeof localStorage === 'undefined') return 'zh-CN';
  try {
    return normalizeLocale(localStorage.getItem(STORAGE_KEY)) ?? systemLocale();
  } catch {
    return systemLocale();
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* 浏览器禁用存储时仅保留当前会话。 */ }
  };
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (source, params) => translate(locale, source, params),
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
