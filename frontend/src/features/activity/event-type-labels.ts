/** Human labels for activity `event_type` values (API stores dotted keys). */
const EVENT_TYPE_LABELS: Record<string, string> = {
  'string.created': 'Created',
  'string.updated': 'Updated',
  'string.renamed': 'Renamed',
  'string.source_updated': 'Source updated',
  'string.moved': 'Moved',
  'string.tagged': 'Tagged',
  'translation.updated': 'Translations updated',
  'string.published': 'Published',
  'string.unpublished': 'Unpublished',
  'string.pending_delete': 'Marked for deletion',
  'string.deleted': 'Deleted',
  'string.restored': 'Restored',
  import: 'Import',
  translate: 'AI translate',
  batch: 'Batch action',
}

const BATCH_KIND_LABELS: Record<string, string> = {
  import: 'Import',
  excel_import: 'Excel import',
  batch: 'Batch',
  translate: 'AI translate',
  revert: 'Revert',
  snapshot_restore: 'Snapshot restore',
}

export const EVENT_TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'string.created', label: EVENT_TYPE_LABELS['string.created'] },
  { value: 'translation.updated', label: EVENT_TYPE_LABELS['translation.updated'] },
  { value: 'string.published', label: EVENT_TYPE_LABELS['string.published'] },
  { value: 'import', label: EVENT_TYPE_LABELS.import },
  { value: 'translate', label: EVENT_TYPE_LABELS.translate },
  { value: 'batch', label: EVENT_TYPE_LABELS.batch },
  { value: 'string.restored', label: EVENT_TYPE_LABELS['string.restored'] },
]

export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType.replace(/^string\./, '').replace(/_/g, ' ')
}

export function batchKindLabel(batchKind: string): string {
  return BATCH_KIND_LABELS[batchKind] ?? batchKind.replace(/_/g, ' ')
}
