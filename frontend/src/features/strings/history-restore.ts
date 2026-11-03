import type { ActivityChange } from '@/lib/api/types'

const HISTORY_UNRESTORABLE_EVENT_TYPES = new Set([
  'string.published',
  'string.unpublished',
  'string.pending_delete',
  'string.deleted',
])

interface RestorableActivity {
  is_history_restorable?: boolean
  restore_blocked_reason?: string | null
  action: string
  event_type: string
  changed?: ActivityChange[]
}

export function canRestoreHistoryVersion(activity: RestorableActivity) {
  if (activity.is_history_restorable !== undefined) {
    return activity.is_history_restorable
  }
  if (activity.action === 'delete') return false
  if (activity.event_type === 'string.published') {
    return (
      activity.changed?.some(
        (change) =>
          change.scope === 'draft' &&
          ['key', 'source_text', 'description', 'module_id', 'tags', 'translation'].includes(
            change.field
          ) &&
          change.before !== change.after
      ) ?? false
    )
  }
  return !HISTORY_UNRESTORABLE_EVENT_TYPES.has(activity.event_type)
}

/** Mirrors the backend's `_history_restore_reject_detail()` copy so the disabled
 * button's reason matches what the API would say if asked anyway. */
export function historyRestoreBlockedReason(activity: RestorableActivity): string | null {
  if (canRestoreHistoryVersion(activity)) return null
  if (activity.restore_blocked_reason) {
    return activity.restore_blocked_reason
  }
  if (activity.action === 'delete' || activity.event_type === 'string.deleted') {
    return 'Deleted strings cannot be restored from History. Use Restore on the Deleted filter.'
  }
  if (activity.event_type === 'string.published' || activity.event_type === 'string.unpublished') {
    return (
      'Publication-only and unpublish events cannot be restored from History. ' +
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
