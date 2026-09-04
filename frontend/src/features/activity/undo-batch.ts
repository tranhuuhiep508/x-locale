import { ApiError } from '@/lib/api/client'
import type { ActivityFeedCard } from '@/lib/api/types'

export function undoDescription(card: ActivityFeedCard): string {
  const created = card.counts.created ?? 0
  if (created > 0) {
    const noun = created === 1 ? 'string' : 'strings'
    return (
      `This undoes ${card.children_count} strings. ${created} new ${noun} will be moved to Deleted ` +
      '(or queued for public removal if already published).'
    )
  }
  return `This restores ${card.children_count} strings to their values before this action.`
}

export function undoOverwriteDescription(): string {
  return 'Later edits will be overwritten.'
}

export function isUndoConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}
