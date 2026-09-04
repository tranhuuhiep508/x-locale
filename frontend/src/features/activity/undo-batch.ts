import { ApiError } from '@/lib/api/client'
import type { ActivityFeedCard } from '@/lib/api/types'

function stringNoun(count: number): string {
  return count === 1 ? 'string' : 'strings'
}

export function undoDescription(card: ActivityFeedCard): string {
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

export function undoOverwriteDescription(): string {
  return 'Later edits will be overwritten.'
}

export function isUndoConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}
