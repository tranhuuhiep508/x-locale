import { describe, expect, it } from 'vitest'
import { TAG_PRESET_COLORS, moduleSlugFromName, nextTagColor, tagSwatchColor, uniqueModuleSlug } from './catalog-create'

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
    expect(nextTagColor([TAG_PRESET_COLORS[0], TAG_PRESET_COLORS[1]])).toBe(TAG_PRESET_COLORS[2])
  })

  it('falls back to the first preset when all are used', () => {
    expect(nextTagColor([...TAG_PRESET_COLORS])).toBe(TAG_PRESET_COLORS[0])
  })
})

describe('tagSwatchColor', () => {
  it('maps daylight and legacy hexes onto theme variables', () => {
    expect(tagSwatchColor(TAG_PRESET_COLORS[0])).toBe('var(--tag-haze)')
    expect(tagSwatchColor('#64748B')).toBe('var(--tag-haze)')
    expect(tagSwatchColor('#2563eb')).toBe('var(--tag-azure)')
    expect(tagSwatchColor('#f97316')).toBe('var(--tag-gold)')
  })

  it('leaves a custom picker color untouched', () => {
    expect(tagSwatchColor('#123456')).toBe('#123456')
  })
})
