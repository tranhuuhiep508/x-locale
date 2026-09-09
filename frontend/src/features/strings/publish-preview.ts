import type { BatchFilter, StringEntry } from '@/lib/api/types'
import type { StringsSearch } from '@/lib/schemas'
import { differs, isReleased } from '@/features/strings/working-copy'

export type PublishKind = 'new' | 'update' | 'removal' | 'noop'

export type PublishFieldChange = {
  field: string
  label: string
  working: string
  published: string | null
  firstPublish: boolean
}

export type PublishPreviewRow = {
  id: string
  key: string
  moduleSlug: string | null
  kind: PublishKind
  summary: string
  fields: PublishFieldChange[]
}

export type PublishPreviewCounts = {
  new: number
  update: number
  removal: number
  noop: number
}

export type PublishPreview = {
  newRows: PublishPreviewRow[]
  updates: PublishPreviewRow[]
  removals: PublishPreviewRow[]
  noops: PublishPreviewRow[]
  counts: PublishPreviewCounts
  publishableIds: string[]
}

export const PUBLISH_KIND_ORDER: PublishKind[] = ['new', 'update', 'removal', 'noop']

export const PUBLISH_SECTION_LABEL: Record<PublishKind, string> = {
  new: 'New to public',
  update: 'Content updates',
  removal: 'Removals',
  noop: 'No-op',
}

function norm(value: string | null | undefined): string {
  return value ?? ''
}

function isEmptyPublished(value: string | null | undefined): boolean {
  return value == null || value === ''
}

function fieldChange(
  field: string,
  label: string,
  working: string,
  published: string | null | undefined,
): PublishFieldChange | null {
  if (!differs(working, published)) return null
  const emptyPublished = isEmptyPublished(published)
  return {
    field,
    label,
    working,
    published: emptyPublished ? null : (published ?? ''),
    firstPublish: emptyPublished,
  }
}

function localeLabel(locale: string): string {
  return locale.toUpperCase()
}

function sortedTranslations(entry: StringEntry) {
  return [...entry.translations].sort((a, b) => a.locale.localeCompare(b.locale))
}

export function contentFieldChanges(entry: StringEntry): PublishFieldChange[] {
  const fields: PublishFieldChange[] = []
  const keyChange = fieldChange('key', 'Key', entry.key, entry.published_key)
  if (keyChange) fields.push(keyChange)
  const moduleChange = fieldChange(
    'module',
    'Module',
    entry.module_slug ?? '',
    entry.published_module_slug ?? '',
  )
  if (moduleChange) fields.push(moduleChange)
  const sourceChange = fieldChange(
    'source',
    'Source',
    entry.source_text,
    entry.published_source_text,
  )
  if (sourceChange) fields.push(sourceChange)
  for (const translation of sortedTranslations(entry)) {
    const change = fieldChange(
      translation.locale,
      localeLabel(translation.locale),
      translation.value ?? '',
      translation.published_value,
    )
    if (change) fields.push(change)
  }
  return fields
}

function workingOnlyFields(entry: StringEntry): PublishFieldChange[] {
  const fields: PublishFieldChange[] = [
    {
      field: 'key',
      label: 'Key',
      working: entry.key,
      published: null,
      firstPublish: true,
    },
  ]
  if (entry.module_slug) {
    fields.push({
      field: 'module',
      label: 'Module',
      working: entry.module_slug,
      published: null,
      firstPublish: true,
    })
  }
  fields.push({
    field: 'source',
    label: 'Source',
    working: entry.source_text,
    published: null,
    firstPublish: true,
  })
  for (const translation of sortedTranslations(entry)) {
    if (!norm(translation.value).trim()) continue
    fields.push({
      field: translation.locale,
      label: localeLabel(translation.locale),
      working: translation.value,
      published: null,
      firstPublish: true,
    })
  }
  return fields
}

export function classifyPublishRow(entry: StringEntry): PublishPreviewRow {
  if (entry.deleted_at) {
    return {
      id: entry.id,
      key: entry.key,
      moduleSlug: entry.module_slug,
      kind: 'noop',
      summary: 'Soft-deleted — skipped',
      fields: [],
    }
  }
  if (entry.pending_delete) {
    return {
      id: entry.id,
      key: entry.key,
      moduleSlug: entry.module_slug,
      kind: 'removal',
      summary: 'will remove from public on publish',
      fields: [],
    }
  }
  if (!isReleased(entry)) {
    return {
      id: entry.id,
      key: entry.key,
      moduleSlug: entry.module_slug,
      kind: 'new',
      summary: 'will appear on public',
      fields: workingOnlyFields(entry),
    }
  }
  const fields = contentFieldChanges(entry)
  if (fields.length > 0) {
    return {
      id: entry.id,
      key: entry.key,
      moduleSlug: entry.module_slug,
      kind: 'update',
      summary: 'will update public',
      fields,
    }
  }
  if (entry.status !== 'public') {
    return {
      id: entry.id,
      key: entry.key,
      moduleSlug: entry.module_slug,
      kind: 'new',
      summary: 'will appear on public',
      fields: workingOnlyFields(entry),
    }
  }
  return {
    id: entry.id,
    key: entry.key,
    moduleSlug: entry.module_slug,
    kind: 'noop',
    summary: 'Already in sync',
    fields: [],
  }
}

function byKey(a: PublishPreviewRow, b: PublishPreviewRow): number {
  return a.key.localeCompare(b.key) || a.id.localeCompare(b.id)
}

export function buildPublishPreview(entries: StringEntry[]): PublishPreview {
  const newRows: PublishPreviewRow[] = []
  const updates: PublishPreviewRow[] = []
  const removals: PublishPreviewRow[] = []
  const noops: PublishPreviewRow[] = []

  for (const entry of entries) {
    const row = classifyPublishRow(entry)
    if (row.kind === 'new') newRows.push(row)
    else if (row.kind === 'update') updates.push(row)
    else if (row.kind === 'removal') removals.push(row)
    else noops.push(row)
  }

  newRows.sort(byKey)
  updates.sort(byKey)
  removals.sort(byKey)
  noops.sort(byKey)

  const publishableIds = [...newRows, ...updates, ...removals].map((row) => row.id)
  return {
    newRows,
    updates,
    removals,
    noops,
    counts: {
      new: newRows.length,
      update: updates.length,
      removal: removals.length,
      noop: noops.length,
    },
    publishableIds,
  }
}

export function previewCountLabel(counts: PublishPreviewCounts): string {
  const parts: string[] = []
  if (counts.update) parts.push(`${counts.update} update`)
  if (counts.new) parts.push(`${counts.new} new`)
  if (counts.removal) parts.push(`${counts.removal} removal`)
  return parts.join(' · ')
}

export function hasPublishableChanges(preview: PublishPreview): boolean {
  return preview.publishableIds.length > 0
}

export function rowsForKind(preview: PublishPreview, kind: PublishKind): PublishPreviewRow[] {
  if (kind === 'new') return preview.newRows
  if (kind === 'update') return preview.updates
  if (kind === 'removal') return preview.removals
  return preview.noops
}

export function searchToBatchFilter(
  search: Pick<
    StringsSearch,
    | 'module'
    | 'tag'
    | 'q'
    | 'missing_locale'
    | 'status'
    | 'pending_delete'
    | 'has_unpublished_changes'
    | 'deleted'
    | 'max_confidence'
  >,
): BatchFilter {
  return {
    module_id: search.module,
    tag_id: search.tag,
    q: search.q,
    missing_locale: search.missing_locale,
    status: search.status,
    pending_delete: search.pending_delete,
    has_unpublished_changes: search.has_unpublished_changes,
    deleted: search.deleted,
    max_confidence: search.max_confidence,
  }
}
