import type { SortingState } from '@tanstack/react-table'

export type CatalogSortSearch = {
  sort?: string
  order?: string
}

export const CATALOG_SORT_FIELDS = [
  'key',
  'source_text',
  'status',
  'updated_at',
  'updated_by_label',
  'created_at',
  'created_by_label',
] as const

export type CatalogSortField = (typeof CATALOG_SORT_FIELDS)[number]
export type CatalogSortOrder = 'asc' | 'desc'

const FIELD_SET = new Set<string>(CATALOG_SORT_FIELDS)

export function isCatalogSortField(value: string): value is CatalogSortField {
  return FIELD_SET.has(value)
}

export function parseCatalogSortField(value: unknown): CatalogSortField | undefined {
  if (typeof value !== 'string') return undefined
  return isCatalogSortField(value) ? value : undefined
}

export function parseCatalogSortOrder(value: unknown): CatalogSortOrder | undefined {
  if (value === 'asc' || value === 'desc') return value
  return undefined
}

export function resolvedCatalogSort(search: CatalogSortSearch) {
  return {
    sort: parseCatalogSortField(search.sort) ?? 'key',
    order: parseCatalogSortOrder(search.order) ?? 'asc',
  }
}

export function catalogSortSearchUpdates(
  current: CatalogSortSearch,
  columnId: string,
): CatalogSortSearch {
  if (!isCatalogSortField(columnId)) {
    return { sort: current.sort, order: current.order }
  }
  const resolved = resolvedCatalogSort(current)
  if (columnId !== resolved.sort) {
    return normalizeCatalogSortUrl({ sort: columnId, order: 'asc' })
  }
  if (resolved.order === 'asc') {
    return normalizeCatalogSortUrl({ sort: columnId, order: 'desc' })
  }
  return normalizeCatalogSortUrl({})
}

export function normalizeCatalogSortUrl(
  params: Partial<{ sort: CatalogSortField; order: CatalogSortOrder }>,
): CatalogSortSearch {
  const sort = params.sort ?? 'key'
  const order = params.order ?? 'asc'
  if (sort === 'key' && order === 'asc') {
    return { sort: undefined, order: undefined }
  }
  return { sort, order }
}

export function catalogSortChanged(
  before: CatalogSortSearch,
  after: CatalogSortSearch,
): boolean {
  const a = resolvedCatalogSort(before)
  const b = resolvedCatalogSort(after)
  return a.sort !== b.sort || a.order !== b.order
}

export function sortingStateFromSearch(search: CatalogSortSearch): SortingState {
  const { sort, order } = resolvedCatalogSort(search)
  return [{ id: sort, desc: order === 'desc' }]
}
