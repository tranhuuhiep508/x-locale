import JSON5 from 'json5'
import type { PasteReview, PasteRow, StringEntry } from '@/lib/api/types'

export type ParsedPasteRow = { key: string; source_text: string }

export type ParseFlatJsonResult =
  | { ok: true; rows: ParsedPasteRow[]; map: Record<string, string>; warning?: string }
  | { ok: false; error: string }

export const PASTE_JSON_PLACEHOLDER = `{
  "welcome.title": "Welcome back",
  "welcome.cta": "Continue"
}`

function valueTypeLabel(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function parseFlatI18nJson(text: string): ParseFlatJsonResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, error: 'Paste a JSON object like {"key": "source text"}.' }
  }

  let parsed: unknown
  try {
    parsed = JSON5.parse(trimmed)
  } catch {
    return {
      ok: false,
      error: 'Invalid JSON/JSON5. Check for missing commas or quotes.',
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error:
        'Paste a flat JSON object like {"key": "source text"}. Arrays and primitives are not supported.',
    }
  }

  const obj = parsed as Record<string, unknown>
  const rows: ParsedPasteRow[] = []
  const map: Record<string, string> = {}
  for (const [rawKey, value] of Object.entries(obj)) {
    if (!rawKey.trim()) {
      return { ok: false, error: 'JSON keys must be non-empty strings.' }
    }
    if (typeof value !== 'string') {
      const kind = valueTypeLabel(value)
      return {
        ok: false,
        error: `Key "${rawKey}" must have a string value (got ${kind}). Nested objects and arrays are not supported.`,
      }
    }
    rows.push({ key: rawKey, source_text: value })
    // Own property so a "__proto__" key stays data and does not change the prototype.
    Object.defineProperty(map, rawKey, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
  const warning = duplicateKeyWarning(trimmed)
  return warning ? { ok: true, rows, map, warning } : { ok: true, rows, map }
}

function duplicateKeyWarning(text: string): string | undefined {
  const seen = new Set<string>()
  const dupes: string[] = []
  const re =
    /\/\/[^\n\r\u2028\u2029]*|\/\*[\s\S]*?\*\/|("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|([$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*)|[\s\S]/uy
  let pending: string | null = null
  for (;;) {
    const match = re.exec(text)
    if (!match) break
    const [token, quoted, ident] = match
    if (quoted) {
      try {
        pending = JSON5.parse(quoted) as string
      } catch {
        pending = null
      }
      continue
    }
    if (ident) {
      pending = ident
      continue
    }
    if (token.startsWith('/') || token.trim() === '') continue
    if (token === ':' && pending !== null) {
      if (seen.has(pending)) {
        if (!dupes.includes(pending)) dupes.push(pending)
      } else {
        seen.add(pending)
      }
    }
    pending = null
  }
  if (dupes.length === 0) return
  const listed = dupes.map((key) => JSON.stringify(key)).join(', ')
  return `Duplicate keys (${listed}): the later value is used.`
}

/** The compact review keeps every row on one screen, like the AI translation review. */
export const PASTE_MAX_ROWS = 100
/** Rows per AI request; larger pastes are translated in several requests. */
export const PASTE_AI_CHUNK = 20

/** Request rows for the first preview: the pasted text is the source or one translation. */
export function pastedRows(
  rows: ParsedPasteRow[],
  locale: string,
  baseLocale: string,
): PasteRow[] {
  return rows.map(({ key, source_text: value }) =>
    locale === baseLocale ? { key, source_text: value } : { key, translations: { [locale]: value } },
  )
}

/** A pasted string being reviewed in memory. Nothing is saved until Save or Publish. */
export type PasteDraftRow = {
  key: string
  mode: 'create' | 'update'
  /** Projected working copy from the latest preview, including the pasted text. */
  entry: StringEntry
  source: string
  translations: Record<string, string>
  scores: Record<string, number | null>
}

function valuesOf(entry: StringEntry): Record<string, string> {
  return Object.fromEntries(entry.translations.map((t) => [t.locale, t.value]))
}

/**
 * Rows from a preview. Edits from `previous` (a refresh after a stale save) are kept
 * wherever the user changed a value away from the earlier projection.
 */
export function draftRowsFromReview(
  review: PasteReview,
  previous: PasteDraftRow[] = [],
): PasteDraftRow[] {
  const before = new Map(previous.map((row) => [row.key, row]))
  return review.items.map(({ key, mode, entry }) => {
    const translations = valuesOf(entry)
    const scores: Record<string, number | null> = Object.fromEntries(
      entry.translations.map((t) => [t.locale, t.confidence]),
    )
    let source = entry.source_text
    const old = before.get(key)
    if (old) {
      const oldBaseline = valuesOf(old.entry)
      if (old.source !== old.entry.source_text) source = old.source
      for (const [locale, value] of Object.entries(old.translations)) {
        if (value !== (oldBaseline[locale] ?? '')) {
          translations[locale] = value
          scores[locale] = old.scores[locale] ?? null
        }
      }
    }
    return { key, mode, entry, source, translations, scores }
  })
}

/** Request rows carrying the reviewed source and translations. The server ignores no-ops. */
export function draftRowsToRequest(rows: PasteDraftRow[], targetLocales: string[]): PasteRow[] {
  return rows.map((row) => {
    const baseline = valuesOf(row.entry)
    const translations: Record<string, string> = {}
    const scores: Record<string, number | null> = {}
    for (const locale of targetLocales) {
      const value = row.translations[locale] ?? ''
      if (!value && !baseline[locale]) continue
      translations[locale] = value
      if (row.scores[locale] != null) scores[locale] = row.scores[locale]
    }
    // Always send the source: the projection already contains pasted text, so comparing
    // against it would drop the paste. The server ignores a source equal to the saved one.
    const request: PasteRow = { key: row.key, source_text: row.source, translations }
    if (Object.keys(scores).length) request.translation_scores = scores
    return request
  })
}

/** Cells AI should fill: empty targets only, so pasted or reviewed text is kept. */
export function emptyTranslationCells(
  rows: PasteDraftRow[],
  targetLocales: string[],
): Array<{ id: string; source_text: string; locales: string[] }> {
  return rows.flatMap((row) => {
    const locales = targetLocales.filter((locale) => !(row.translations[locale] ?? '').trim())
    return locales.length && row.source.trim()
      ? [{ id: row.key, source_text: row.source, locales }]
      : []
  })
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
