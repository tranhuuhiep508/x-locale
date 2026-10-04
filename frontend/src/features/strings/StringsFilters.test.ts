import { describe, expect, it } from 'vitest'
import { stringsSearchSchema, type StringsSearch } from '@/lib/schemas'
import {
  hasActiveStringFilters,
  moduleFilterUpdates,
  statusFilterUpdates,
  tagFilterUpdates,
  translationFilterUpdates,
} from './StringsFilters'

describe('advanced string filter URL state', () => {
  it('parses period and custom time range query parameters', () => {
    expect(
      stringsSearchSchema.parse({
        period: '7d',
        since: '2026-01-01T00:00:00.000Z',
        until: '2026-01-02T00:00:00.000Z',
      }),
    ).toMatchObject({
      period: '7d',
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-01-02T00:00:00.000Z',
    })
  })

  it('parses boolean and rolling-window query parameters', () => {
    expect(
      stringsSearchSchema.parse({
        unassigned_module: 'true',
        untagged: true,
        missing_any: 'true',
        never_published: 'false',
        complete_locale: 'fr',
        updated_within_days: '30',
      }),
    ).toMatchObject({
      unassigned_module: true,
      untagged: true,
      missing_any: true,
      never_published: false,
      complete_locale: 'fr',
      updated_within_days: 30,
    })
  })

  it('rejects unsupported update windows', () => {
    expect(() => stringsSearchSchema.parse({ updated_within_days: '14' })).toThrow()
  })

  it.each<Partial<StringsSearch>>([
    { unassigned_module: true },
    { untagged: true },
    { missing_any: true },
    { complete_locale: 'en' },
    { never_published: true },
    { pending_delete: true },
    { updated_within_days: 7 },
    { period: '24h' },
    { since: '2026-01-01' },
  ])('detects an active advanced filter: %o', (search) => {
    expect(hasActiveStringFilters(search)).toBe(true)
  })
})

describe('advanced string filter updates', () => {
  it('keeps status choices mutually exclusive and clears them together', () => {
    expect(statusFilterUpdates('pending_delete')).toMatchObject({
      pending_delete: true,
      never_published: undefined,
      has_unpublished_changes: undefined,
      status: undefined,
      deleted: undefined,
    })
    expect(statusFilterUpdates('all')).toEqual({
      status: undefined,
      has_unpublished_changes: undefined,
      pending_delete: undefined,
      never_published: undefined,
      deleted: undefined,
    })
  })

  it('maps organization sentinels without leaking them as ids', () => {
    expect(moduleFilterUpdates('unassigned')).toEqual({
      module: undefined,
      unassigned_module: true,
    })
    expect(moduleFilterUpdates('module-id')).toEqual({
      module: 'module-id',
      unassigned_module: undefined,
    })
    expect(tagFilterUpdates('untagged')).toEqual({ tag: undefined, untagged: true })
    expect(tagFilterUpdates('all')).toEqual({ tag: undefined, untagged: undefined })
  })

  it('keeps translation coverage choices mutually exclusive and clearable', () => {
    expect(translationFilterUpdates('missing:any')).toEqual({
      missing_any: true,
      missing_locale: undefined,
      complete_locale: undefined,
    })
    expect(translationFilterUpdates('complete:fr')).toEqual({
      missing_any: undefined,
      missing_locale: undefined,
      complete_locale: 'fr',
    })
    expect(translationFilterUpdates('all')).toEqual({
      missing_any: undefined,
      missing_locale: undefined,
      complete_locale: undefined,
    })
  })
})
