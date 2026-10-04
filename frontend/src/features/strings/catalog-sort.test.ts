import { describe, expect, it } from 'vitest'
import { stringsSearchSchema } from '@/lib/schemas'
import { toStringListParams } from '@/lib/api/strings'
import {
  type CatalogSortSearch,
  catalogSortChanged,
  catalogSortSearchUpdates,
  resolvedCatalogSort,
  sortingStateFromSearch,
} from '@/features/strings/catalog-sort'
import { getStringColumns } from '@/features/strings/string-columns'

describe('stringsSearchSchema sort params', () => {
  it('keeps valid sort and order', () => {
    expect(stringsSearchSchema.parse({ sort: 'updated_at', order: 'desc' })).toMatchObject({
      sort: 'updated_at',
      order: 'desc',
    })
  })

  it('drops invalid sort and order without throwing', () => {
    expect(stringsSearchSchema.parse({ sort: 'tags', order: 'ASC' })).toMatchObject({
      sort: undefined,
      order: undefined,
    })
  })
})

describe('toStringListParams', () => {
  it('forwards sort params to the API', () => {
    expect(
      toStringListParams({ sort: 'source_text', order: 'asc', page: 2 }),
    ).toMatchObject({
      sort: 'source_text',
      order: 'asc',
      page: 2,
    })
  })
})

describe('catalogSortSearchUpdates', () => {
  it('switches column to asc and resets page via sortChanged', () => {
    const next = catalogSortSearchUpdates({ sort: 'key', order: 'desc' }, 'source_text')
    expect(next).toEqual({ sort: 'source_text', order: 'asc' })
    expect(catalogSortChanged({ sort: 'key', order: 'desc' }, next)).toBe(true)
  })

  it('toggles asc to desc on the same column', () => {
    expect(catalogSortSearchUpdates({ sort: 'key', order: 'asc' }, 'key')).toEqual({
      sort: 'key',
      order: 'desc',
    })
  })

  it('clears URL params when leaving desc on the same column', () => {
    expect(catalogSortSearchUpdates({ sort: 'updated_at', order: 'desc' }, 'updated_at')).toEqual(
      {},
    )
    expect(resolvedCatalogSort({})).toEqual({ sort: 'key', order: 'asc' })
  })

  it('does not count unchanged sort as changed', () => {
    const current: CatalogSortSearch = { sort: 'key', order: 'asc' }
    expect(catalogSortChanged(current, current)).toBe(false)
  })
})

describe('sortingStateFromSearch', () => {
  it('maps URL sort to TanStack sorting state', () => {
    expect(sortingStateFromSearch({ sort: 'status', order: 'desc' })).toEqual([
      { id: 'status', desc: true },
    ])
  })
})

describe('getStringColumns sorting flags', () => {
  it('enables sorting only on the allowlist', () => {
    const columns = getStringColumns(['en'])
    const sortable = columns.filter((col) => col.enableSorting)
    expect(
      sortable.map((col) => col.id ?? (col as { accessorKey?: string }).accessorKey).sort(),
    ).toEqual(
      [
        'created_at',
        'created_by_label',
        'key',
        'source_text',
        'status',
        'updated_at',
        'updated_by_label',
      ].sort(),
    )
    expect(columns.find((col) => col.id === 'select')?.enableSorting).toBe(false)
    expect(columns.find((col) => col.id === 'actions')?.enableSorting).toBe(false)
    expect(columns.find((col) => col.id === 'tags')?.enableSorting).toBe(false)
    expect(columns.find((col) => col.id === 'locale-en')?.enableSorting).toBe(false)
  })
})
