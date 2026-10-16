import JSON5 from 'json5'
import type { ImportResult } from '@/lib/api/types'

export type PasteRow = { key: string; source_text: string }

export type ParseFlatJsonResult =
  | { ok: true; rows: PasteRow[]; map: Record<string, string>; warning?: string }
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
  const rows: PasteRow[] = []
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

export function emptyImportPreview(): ImportResult {
  return {
    created: 0,
    updated: 0,
    total: 0,
    dry_run: true,
    diff: {
      create: [],
      update: [],
      orphan: [],
      create_count: 0,
      update_count: 0,
      orphan_count: 0,
    },
    batch_id: null,
  }
}

export function jsonMapToImportFormData(
  map: Record<string, string>,
  locale: string,
): FormData {
  const file = new File([JSON.stringify(map)], `${locale}.json`, {
    type: 'application/json',
  })
  const formData = new FormData()
  formData.append('file', file)
  return formData
}

export type PasteImportParams = {
  locale: string
  dry_run: string
  status: 'draft'
  partial: string
  module_id?: string
  tag_ids?: string[]
}

export function pasteImportParams(options: {
  locale: string
  dry: boolean
  moduleId?: string
  tagIds?: string[]
}): PasteImportParams {
  const params: PasteImportParams = {
    locale: options.locale,
    dry_run: String(options.dry),
    status: 'draft',
    partial: 'true',
  }
  if (options.moduleId) params.module_id = options.moduleId
  if (options.tagIds && options.tagIds.length > 0) params.tag_ids = options.tagIds
  return params
}
