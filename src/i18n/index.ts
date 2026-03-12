import { ar, TranslationKeys } from './translations/ar';
import { en } from './translations/en';

export type Language = 'ar' | 'en';

export const translations: Record<Language, TranslationKeys> = {
  ar,
  en,
};

export const languageNames: Record<Language, string> = {
  ar: 'العربية',
  en: 'English',
};

export const isRTL = (lang: Language): boolean => lang === 'ar';

export { ar, en };
export type { TranslationKeys };
