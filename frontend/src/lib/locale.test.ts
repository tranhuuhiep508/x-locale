import { describe, expect, it } from 'vitest'
import { languageOf, localeDir } from '@/lib/locale'
import type { Language } from '@/lib/api/types'

const catalog: Language[] = [
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
]

describe('locale helpers', () => {
  it('marks Arabic and Hebrew as rtl', () => {
    expect(localeDir('ar')).toBe('rtl')
    expect(localeDir('he')).toBe('rtl')
    expect(localeDir('zh-TW')).toBe('ltr')
    expect(localeDir('vi')).toBe('ltr')
  })

  it('falls back to the code when a language is missing', () => {
    const unknown = languageOf(catalog, 'ja')
    expect(unknown).toEqual({ code: 'ja', name: 'ja', native: 'ja' })
    expect(languageOf(catalog, 'vi').native).toBe('Tiếng Việt')
  })
})
