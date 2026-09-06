export const IMPORT_KEY_LIST_LIMIT = 100

export type VisibleImportKeys = {
  items: string[]
  matchCount: number
  total: number
}

export function visibleImportKeys(
  keys: string[],
  query: string,
  limit = IMPORT_KEY_LIST_LIMIT,
): VisibleImportKeys {
  const needle = query.trim().toLowerCase()
  const matched = needle ? keys.filter((key) => key.toLowerCase().includes(needle)) : keys
  return {
    items: matched.slice(0, limit),
    matchCount: matched.length,
    total: keys.length,
  }
}

export function importKeyListFooter({
  query,
  matchCount,
  total,
  label,
  limit = IMPORT_KEY_LIST_LIMIT,
}: {
  query: string
  matchCount: number
  total: number
  label: string
  limit?: number
}): string | null {
  const filtered = query.trim().length > 0
  if (filtered) {
    if (matchCount === 0) return `No keys match “${query.trim()}”`
    if (matchCount > limit) return `Showing ${limit} of ${matchCount} matches`
    return `${matchCount} matches`
  }
  if (total > limit) return `Showing ${limit} of ${total} ${label}`
  return null
}

export function hasMatchingImportKeys(sections: string[][], query: string): boolean {
  return sections.some((keys) => visibleImportKeys(keys, query).matchCount > 0)
}
