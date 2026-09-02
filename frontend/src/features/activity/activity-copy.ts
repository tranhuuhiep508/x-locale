import type { ActivityChange } from '@/lib/api/types'

const ACTION_LABELS: Record<string, string> = {
  'string.created': 'Created a string',
  'string.renamed': 'Renamed a string',
  'string.source_updated': 'Updated source text',
  'string.moved': 'Moved a string',
  'string.tagged': 'Updated tags',
  'string.updated': 'Updated a string',
  'translation.updated': 'Updated a translation',
  'string.published': 'Published',
  'string.unpublished': 'Unpublished',
  'string.pending_delete': 'Marked for deletion',
  'string.deleted': 'Deleted a string',
  'string.restored': 'Restored',
  'string.discarded': 'Discarded unpublished changes',
  import: 'Imported strings',
  excel_import: 'Imported from Excel',
  translate: 'Ran AI translate',
  batch: 'Ran a batch action',
  revert: 'Undid a batch',
}

const FIELD_LABELS: Record<string, string> = {
  source_text: 'Source',
  key: 'Key',
  description: 'Description',
  status: 'Status',
  tags: 'Tags',
  translation: 'Translation',
  module_id: 'Module',
}

export function activityActionLabel(eventType: string): string {
  return ACTION_LABELS[eventType] ?? eventType.replaceAll('_', ' ')
}

export function activityFieldLabel(change: ActivityChange): string {
  if (change.locale) return change.locale.toUpperCase()
  return FIELD_LABELS[change.field] ?? change.field
}
