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
      tag: undefined,
      q: undefined,
      missing_locale: undefined,
      status: undefined,
      pending_delete: undefined,
      has_unpublished_changes: undefined,
      deleted: undefined,
      max_confidence: undefined,
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
