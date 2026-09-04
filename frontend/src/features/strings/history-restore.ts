const HISTORY_UNRESTORABLE_EVENT_TYPES = new Set([
  'string.published',
  'string.unpublished',
  'string.pending_delete',
  'string.deleted',
])

export function canRestoreHistoryVersion(activity: {
  after: unknown
  action: string
  event_type: string
}) {
  return (
    Boolean(activity.after) &&
    activity.action !== 'delete' &&
    !HISTORY_UNRESTORABLE_EVENT_TYPES.has(activity.event_type)
  )
}
