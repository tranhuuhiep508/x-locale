import type { ImportResult } from '@/lib/api/types'

export type PasteRow = { key: string; source_text: string }

export type ParseFlatJsonResult =
  | { ok: true; rows: PasteRow[]; map: Record<string, string> }
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
    parsed = JSON.parse(trimmed)
  } catch {
    return {
      ok: false,
      error: 'Invalid JSON. Check for missing commas, quotes, or trailing commas.',
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
    map[rawKey] = value
  }
  return { ok: true, rows, map }
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
      noop_count: 0,
      keys: { create: [], update: [], noop: [] },
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
