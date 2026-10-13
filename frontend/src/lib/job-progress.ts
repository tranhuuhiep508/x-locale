import type { TranslateJobProgress } from '@/lib/api/types'

type Progress = Partial<TranslateJobProgress> | null | undefined

/** Percent for phases that report steps; undefined renders an indeterminate bar. */
export function jobProgressPercent(progress: Progress): number | undefined {
  const total = progress?.chunks_total ?? 0
  if (progress?.phase !== 'writing' || total <= 0) return undefined
  const done = Math.min(Math.max(progress.chunks_done ?? 0, 0), total)
  return Math.round((done / total) * 100)
}

export function importProgressLabel(progress: Progress): string {
  switch (progress?.phase) {
    case 'queued':
      return 'Waiting to start…'
    case 'parsing':
      return 'Reading file…'
    case 'validating':
      return 'Checking keys…'
    case 'writing':
      return 'Saving changes…'
    case 'done':
      return 'Finishing…'
    default:
      return 'Importing…'
  }
}

export function undoProgressLabel(progress: Progress): string {
  switch (progress?.phase) {
    case 'queued':
      return 'Waiting to start…'
    case 'planning': {
      const total = progress.chunks_total ?? 0
      return total > 0 ? `Checking ${total} changes…` : 'Checking changes…'
    }
    case 'writing':
      return 'Restoring strings…'
    case 'done':
      return 'Finishing…'
    default:
      return 'Undoing…'
  }
}
