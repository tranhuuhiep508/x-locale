import type { Language } from '@/lib/api/types'

const RTL_BASES = new Set(['ar', 'he', 'fa', 'ur'])

export function localeBase(code: string): string {
  return code.trim().split('-')[0]?.toLowerCase() ?? ''
}

export function localeDir(code: string): 'rtl' | 'ltr' {
  return RTL_BASES.has(localeBase(code)) ? 'rtl' : 'ltr'
}

export function languageOf(languages: Language[], code: string): Language {
  return (
    languages.find((language) => language.code === code) ?? {
      code,
      name: code,
      native: code,
    }
  )
}

export function languageKeywords(language: Language): string {
  return `${language.code} ${language.name} ${language.native}`
}
