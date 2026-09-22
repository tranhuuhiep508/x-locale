import type { ActivityChange, ActivityChangeScope } from '@/lib/api/types'
import { formatDate } from '@/lib/utils'

const FIELD_LABELS: Record<string, string> = {
  key: 'Key',
  source_text: 'Source text',
  description: 'Description',
  status: 'Status',
  module_id: 'Module',
  tags: 'Tags',
  published_key: 'Key',
  published_source_text: 'Source text',
  published_module_id: 'Module',
  published_at: 'Published at',
}

/** Human label for a single changed field/translation row. */
export function changeFieldLabel(change: ActivityChange): string {
  if (change.field === 'translation') {
    return change.locale ? change.locale.toUpperCase() : 'Translation'
  }
  return FIELD_LABELS[change.field] ?? change.field
}

/** Header label for a group of changes sharing the same scope. */
export function changeScopeLabel(scope: ActivityChangeScope): string {
  return scope === 'published' ? 'Published snapshot' : 'Draft (working copy)'
}

/** Render-ready value for a before/after cell, with an em dash placeholder for empty values. */
export function changeDisplayValue(change: ActivityChange, value: string | null): string {
  if (value === null || value === '') return '—'
  if (change.field === 'published_at') return formatDate(value)
  return value
}

export interface ChangeGroup {
  scope: ActivityChangeScope
  changes: ActivityChange[]
}

/** Split a flat list of changes into draft/published groups, preserving order. */
export function groupChangesByScope(changes: ActivityChange[]): ChangeGroup[] {
  const draft = changes.filter((change) => change.scope !== 'published')
  const published = changes.filter((change) => change.scope === 'published')
  const groups: ChangeGroup[] = []
  if (draft.length > 0) groups.push({ scope: 'draft', changes: draft })
  if (published.length > 0) groups.push({ scope: 'published', changes: published })
  return groups
}
