import { describe, expect, it } from 'vitest'
import type { ImportResult } from '@/lib/api/types'
import {
  buildPastePreview,
  filterKeys,
  hasPasteWrites,
  keysForKind,
  pasteCountLabel,
} from './paste-preview'

function result(overrides: Partial<NonNullable<ImportResult['diff']>> = {}): ImportResult {
  return {
    created: 0,
    updated: 0,
    total: 0,
    dry_run: true,
    batch_id: null,
    diff: {
      create: [],
      update: [],
      orphan: [],
      noop: [],
      create_count: 0,
      update_count: 0,
      orphan_count: 0,
      noop_count: 0,
      ...overrides,
    },
  }
}

describe('buildPastePreview', () => {
  it('uses compact string buckets and full counts from the dry-run', () => {
    const create = Array.from({ length: 120 }, (_, i) => `k${String(i).padStart(3, '0')}`)
    const preview = buildPastePreview(
      result({
        create,
        update: ['save'],
        noop: ['cancel'],
        create_count: 120,
        update_count: 1,
        noop_count: 1,
      }),
    )
    expect(preview.create).toHaveLength(120)
    expect(preview.create[119]).toBe('k119')
    expect(preview.update).toEqual(['save'])
    expect(preview.noop).toEqual(['cancel'])
    expect(preview.counts).toEqual({ create: 120, update: 1, noop: 1 })
    expect(hasPasteWrites(preview)).toBe(true)
    expect(pasteCountLabel(preview.counts)).toBe('120 create · 1 update · 1 no-op')
    expect(keysForKind(preview, 'create')).toBe(preview.create)
  })

  it('treats empty and no-op-only diffs as nothing to write', () => {
    expect(hasPasteWrites(buildPastePreview(null))).toBe(false)
    expect(pasteCountLabel(buildPastePreview(result()).counts)).toBe('')
    const noops = buildPastePreview(
      result({ noop: ['save', 'cancel'], noop_count: 2 }),
    )
    expect(hasPasteWrites(noops)).toBe(false)
    expect(pasteCountLabel(noops.counts)).toBe('2 no-op')
  })
})

describe('filterKeys', () => {
  it('filters by substring, case-insensitive', () => {
    const keys = ['home.hero', 'home.cta', 'auth.save']
    expect(filterKeys(keys, 'HOME')).toEqual(['home.hero', 'home.cta'])
    expect(filterKeys(keys, ' save ')).toEqual(['auth.save'])
    expect(filterKeys(keys, '')).toEqual(keys)
  })
})
