import { ApiError } from '@/lib/api/client'
import type { ActivityFeedCard, RevertPreview, RevertPreviewItem } from '@/lib/api/types'

function stringNoun(count: number): string {
  return count === 1 ? 'string' : 'strings'
}

/**
 * Human description of what undoing this batch will do. Uses the dry-run preview
 * when it has loaded (accurate per-item outcome), falling back to the feed card's
 * aggregate counts while the preview request is in flight.
 */
export function undoDescription(card: ActivityFeedCard, preview?: RevertPreview): string {
  if (!preview) {
    const created = card.counts.created ?? 0
    const total = card.children_count
    if (created > 0) {
      return (
        `This undoes ${total} ${stringNoun(total)}. ${created} new ${stringNoun(created)} will be moved to Deleted ` +
        '(or queued for public removal if already published).'
      )
    }
    return `This restores ${total} ${stringNoun(total)} to their values before this action.`
  }

  const created = preview.outcome_counts.move_to_deleted
  const total = preview.total
  const parts: string[] = []
  if (created > 0) {
    parts.push(
      `This undoes ${total} ${stringNoun(total)}. ${created} new ${stringNoun(created)} will be moved to Deleted ` +
        '(or queued for public removal if already published).',
    )
  } else {
    parts.push(`This restores ${total} ${stringNoun(total)} to their values before this action.`)
  }
  if (preview.affects_published) {
    parts.push('This also changes the published snapshot.')
  }
  return parts.join(' ')
}

export function undoOverwriteDescription(preview?: RevertPreview): string {
  if (preview && preview.conflict_count > 0) {
    return (
      `${preview.conflict_count} ${stringNoun(preview.conflict_count)} ` +
      'were edited since this action and will be overwritten.'
    )
  }
  return 'Later edits will be overwritten.'
}

export function previewTruncated(shown: number, total: number): boolean {
  return shown < total
}

export function previewShowingCaption(shown: number, total: number): string | null {
  if (!previewTruncated(shown, total)) return null
  return `Showing ${shown} of ${total}`
}

export function previewItemsShowingCaption(preview: RevertPreview): string | null {
  return previewShowingCaption(preview.items.length, preview.total)
}

export function previewConflictsShowingCaption(preview: RevertPreview): string | null {
  return previewShowingCaption(preview.conflicts.length, preview.conflict_count)
}

export function outcomeLabel(item: RevertPreviewItem): string {
  switch (item.outcome) {
    case 'move_to_deleted':
      return 'Move to Deleted'
    case 'recreate':
      return 'Recreate'
    case 'already_reverted':
      return 'Already undone'
    case 'missing':
      return 'No longer exists'
    default:
      return 'Restore previous value'
  }
}

export function isUndoConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}
