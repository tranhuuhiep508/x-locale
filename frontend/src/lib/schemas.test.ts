import { describe, expect, it } from 'vitest'
import { activitySearchSchema, moduleCreateSchema, projectSettingsSchema, stringsSearchSchema } from '@/lib/schemas'

describe.each([
  { name: 'strings', schema: stringsSearchSchema, otherFilters: {
    q: 'save', page_size: 50, sort: 'updated_at', order: 'desc',
  } },
  { name: 'activity', schema: activitySearchSchema, otherFilters: { event_type: 'import', actor: 'Dev User' } },
])('$name time search normalization', ({ schema, otherFilters }) => {
  const dates = { since: '2026-01-10', until: '2026-01-12' }

  it('keeps a valid preset and removes conflicting absolute and legacy bounds', () => {
    expect(schema.parse({ ...otherFilters, ...dates, period: '7d', updated_within_days: 30 }))
      .toMatchObject({
        ...otherFilters, period: '7d', since: undefined, until: undefined,
        updated_within_days: undefined,
      })
  })

  it('clears the effective time filter for an unknown period without losing other filters', () => {
    expect(schema.parse({ ...otherFilters, ...dates, period: 'bogus', updated_within_days: 30 }))
      .toMatchObject({
        ...otherFilters, period: undefined, since: undefined, until: undefined,
        updated_within_days: undefined,
      })
  })

  it('preserves custom date bookmarks when no period is present', () => {
    expect(schema.parse({ ...otherFilters, ...dates, updated_within_days: 30 }))
      .toMatchObject({ ...otherFilters, ...dates, updated_within_days: undefined })
  })
})

describe.each([
  { schema: moduleCreateSchema, form: { slug: 'auth', name: 'Auth' }, name: 'module' },
  { schema: projectSettingsSchema, form: { name: 'Demo', base_language: 'vi', target_languages: [], layout: 'flat' }, name: 'project settings' },
])('$name translation context validation', ({ schema, form }) => {
  it('keeps context optional and normalizes explicit null and blank values', () => {
    expect(schema.parse(form).translation_context).toBeUndefined()
    for (const value of [null, '', ' \n\t ']) {
      expect(schema.parse({ ...form, translation_context: value }).translation_context).toBeNull()
    }
    expect(schema.parse({ ...form, translation_context: '  Notes  ' }).translation_context).toBe('Notes')
  })

  it('accepts 500 characters and validates before trimming', () => {
    expect(schema.safeParse({ ...form, translation_context: 'x'.repeat(500) }).success).toBe(true)
    expect(schema.safeParse({ ...form, translation_context: 'x'.repeat(501) }).success).toBe(false)
    expect(schema.safeParse({ ...form, translation_context: ' '.repeat(501) }).success).toBe(false)
  })
})
