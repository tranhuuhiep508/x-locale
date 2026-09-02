import { describe, expect, it } from 'vitest'
import { moduleSlugFromName, nextTagColor, uniqueModuleSlug } from './catalog-create'

describe('moduleSlugFromName', () => {
  it('slugifies a display name', () => {
    expect(moduleSlugFromName('Common strings')).toBe('common-strings')
  })

  it('prefixes names that would not start with a letter', () => {
    expect(moduleSlugFromName('123 auth')).toBe('m-123-auth')
  })

  it('returns empty for punctuation-only names', () => {
    expect(moduleSlugFromName('!!!')).toBe('')
  })
})

describe('uniqueModuleSlug', () => {
  it('keeps the base slug when it is free', () => {
    expect(uniqueModuleSlug('Auth', ['home'])).toBe('auth')
  })

  it('suffixes when the slug already exists', () => {
    expect(uniqueModuleSlug('Auth', ['auth', 'auth-2'])).toBe('auth-3')
  })
})

describe('nextTagColor', () => {
  it('picks the first unused preset', () => {
    expect(nextTagColor(['#64748b', '#0d9488'])).toBe('#2563eb')
  })

  it('falls back to the first preset when all are used', () => {
    expect(
      nextTagColor([
        '#64748b',
        '#0d9488',
        '#2563eb',
        '#9333ea',
        '#e11d48',
        '#f59e0b',
        '#10b981',
        '#f97316',
      ]),
    ).toBe('#64748b')
  })
})
