import type { BatchAction } from '@/lib/api/types'

function stringNoun(count: number): string {
  return count === 1 ? 'string' : 'strings'
}

export function batchSuccessMessage(action: BatchAction, affected: number): string | null {
  const noun = stringNoun(affected)
  switch (action) {
    case 'publish':
      return `Published ${affected} ${noun}`
    case 'unpublish':
      return `Unpublished ${affected} ${noun}`
    case 'discard_changes':
      return `Discarded changes on ${affected} ${noun}`
    case 'discard_delete':
      return `Discarded pending delete on ${affected} ${noun}`
    case 'restore':
      return `Restored ${affected} ${noun}`
    case 'restore_last_history':
      return `Restored last edit on ${affected} ${noun}`
    default:
      return null
  }
}

export function unpublishConfirmCopy(count: number): {
  title: string
  description: string
  confirmLabel: string
} {
  const noun = stringNoun(count)
  return {
    title: count === 1 ? 'Unpublish this string?' : `Unpublish ${count} ${noun}?`,
    description:
      count === 1
        ? 'It moves to draft immediately and drops from public export. The last published snapshot is kept until you publish again. Cancel leaves the catalog unchanged.'
        : 'They move to draft immediately and drop from public export. Last published snapshots are kept until you publish again. Cancel leaves the catalog unchanged.',
    confirmLabel: 'Unpublish',
  }
}
