const HISTORY_UNRESTORABLE_EVENT_TYPES = new Set([
  'string.published',
  'string.unpublished',
  'string.pending_delete',
  'string.deleted',
])

interface RestorableActivity {
  after: unknown
  action: string
  event_type: string
}

export function canRestoreHistoryVersion(activity: RestorableActivity) {
  return (
    Boolean(activity.after) &&
    activity.action !== 'delete' &&
    !HISTORY_UNRESTORABLE_EVENT_TYPES.has(activity.event_type)
  )
}

/** Mirrors the backend's `_history_restore_reject_detail()` copy so the disabled
 * button's reason matches what the API would say if asked anyway. */
export function historyRestoreBlockedReason(activity: RestorableActivity): string | null {
  if (!activity.after) return 'This version cannot be restored'
  if (activity.action === 'delete' || activity.event_type === 'string.deleted') {
    return 'Deleted strings cannot be restored from History. Use Restore on the Deleted filter.'
  }
  if (activity.event_type === 'string.published' || activity.event_type === 'string.unpublished') {
    return (
      'Publish and unpublish cannot be restored from History. ' +
      'Use Publish or Unpublish, or Undo a batch on the Activity feed.'
    )
  }
  if (activity.event_type === 'string.pending_delete') {
    return (
      'Pending deletes cannot be restored from History. ' +
      'Use Restore on the strings grid to cancel the removal.'
    )
  }
  return null
}

/** The first row is the current version — there is nothing to restore to. */
export function shouldShowHistoryRestore(index: number) {
  return index > 0
}

export function isHistoryRestoreEnabled(index: number, activity: RestorableActivity) {
  return shouldShowHistoryRestore(index) && canRestoreHistoryVersion(activity)
}
