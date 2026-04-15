import en from '../locales/en.json'
import ru from '../locales/ru.json'

export type Locale = 'en' | 'ru'

const dictionaries: Record<Locale, Record<string, string>> = { en, ru }

const LOCALE_STORAGE_KEY = 'vostok.locale'

let currentLocale: Locale = detectLocale()

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'ru' || stored === 'en') return stored
  } catch {}

  const browserLang = navigator.language || ''
  if (browserLang.startsWith('ru')) return 'ru'

  return 'en'
}

/**
 * Translate a string key to the current locale.
 *
 * Supports simple interpolation with {0}, {1}, etc:
 *   t('greeting', name) → "Hello, {0}" → "Hello, Greg"
 */
export function t(key: string, ...args: (string | number)[]): string {
  const dict = dictionaries[currentLocale] ?? dictionaries.en
  let str = dict[key] ?? dictionaries.en[key] ?? key

  for (let i = 0; i < args.length; i++) {
    str = str.replaceAll(`{${i}}`, String(args[i]))
  }

  return str
}

/**
 * Russian-aware plural selection.
 *
 * Russian has 3 plural forms:
 *   one:  1, 21, 31, ... (except 11)
 *   few:  2-4, 22-24, ... (except 12-14)
 *   many: 0, 5-20, 25-30, ...
 */
export function plural(
  n: number,
  one: string,
  few: string,
  many: string
): string {
  const abs = Math.abs(n)
  const mod10 = abs % 10
  const mod100 = abs % 100

  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/**
 * Localized plural with count prefix.
 *
 * Usage:
 *   tp(5, 'new_message_one', 'new_message_few', 'new_message_many')
 *   → "5 новых сообщений"
 */
export function tp(
  n: number,
  oneKey: string,
  fewKey: string,
  manyKey: string
): string {
  const form = plural(n, oneKey, fewKey, manyKey)
  return t(form, n)
}

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  currentLocale = locale
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
}

export function getAvailableLocales(): { code: Locale; label: string }[] {
  return [
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
  ]
}
