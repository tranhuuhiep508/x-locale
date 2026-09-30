import { describe, expect, it } from 'vitest'
import { toStringListParams } from '@/lib/api/strings'
import { batchFilterChipLabel, catalogEmptyCopy } from '@/features/strings/batch-filter'
import { hasActiveStringFilters } from '@/features/strings/StringsFilters'

describe('batchFilterChipLabel', () => {
  it('is kind-aware and falls back to the push label', () => {
    expect(batchFilterChipLabel('import')).toBe('Filtered to this push')
    expect(batchFilterChipLabel(undefined)).toBe('Filtered to this push')
    expect(batchFilterChipLabel('excel_import')).toBe('Filtered to this Excel import')
    expect(batchFilterChipLabel('translate')).toBe('Filtered to this translation')
  })
})

describe('catalogEmptyCopy', () => {
  it('uses the batch empty state when the catalog is filtered to a batch', () => {
    expect(catalogEmptyCopy(true, false).title).toBe('No strings left for this batch')
    expect(catalogEmptyCopy(false, true)).toEqual({
      title: 'No strings found',
      description: 'Try adjusting your filters.',
    })
  })
})

describe('toStringListParams', () => {
  it('preserves advanced filters together with batch membership', () => {
    const params = {
      batch_id: '11111111-1111-4111-8111-111111111111',
      unassigned_module: true,
      untagged: true,
      missing_any: false,
      complete_locale: 'en',
      never_published: true,
      updated_within_days: 30 as const,
    }
    expect(toStringListParams({ ...params, batch_kind: 'import' })).toMatchObject(params)
    expect(toStringListParams({ ...params, batch_kind: 'import' })).not.toHaveProperty(
      'batch_kind',
    )
  })

  it('sends batch_id and omits the chip-only batch kind', () => {
    expect(
      toStringListParams({
        batch_id: '11111111-1111-4111-8111-111111111111',
        batch_kind: 'excel_import',
        module: 'm1',
        page: 2,
      }),
    ).toEqual({
      module: 'm1',
      unassigned_module: undefined,
      tag: undefined,
      untagged: undefined,
      q: undefined,
      missing_locale: undefined,
      missing_any: undefined,
      complete_locale: undefined,
      status: undefined,
      pending_delete: undefined,
      never_published: undefined,
      has_unpublished_changes: undefined,
      deleted: undefined,
      max_confidence: undefined,
      updated_within_days: undefined,
      batch_id: '11111111-1111-4111-8111-111111111111',
      page: 2,
      page_size: undefined,
    })
  })
})

describe('hasActiveStringFilters', () => {
  it('treats batch_id as an active filter without requiring other chips', () => {
    expect(hasActiveStringFilters({ batch_id: '11111111-1111-4111-8111-111111111111' })).toBe(
      true,
    )
    expect(hasActiveStringFilters({})).toBe(false)
  })
})
