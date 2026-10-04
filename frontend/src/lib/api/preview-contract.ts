import { z } from 'zod'
import type { RestorePreview, RevertPreview } from './types'

const change = z.object({
  field: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  locale: z.string().nullable().optional().default(null),
  scope: z.enum(['draft', 'published']),
  kind: z.enum(['field', 'translation', 'tags']),
})
const reason = z.string().nullable().optional().default(null)
const count = z.number().int().nonnegative()
const revertPreview = z.object({
  can_revert: z.boolean(),
  requires_force: z.boolean(),
  affects_published: z.boolean(),
  blocked_reason: reason,
  total: count,
  conflict_count: count,
  items: z.array(
    z.object({
      activity_id: z.string(),
      string_id: z.string().nullable().optional().default(null),
      string_key: z.string().nullable().optional().default(null),
      outcome: z.enum([
        'restore_values',
        'move_to_deleted',
        'recreate',
        'already_reverted',
        'missing',
      ]),
      conflict: z.boolean(),
      affects_published: z.boolean(),
      blocked_reason: reason,
      change_count: count,
      changes: z.array(change),
    })
  ),
  conflicts: z.array(
    z.object({
      activity_id: z.string(),
      string_key: z.string().nullable().optional().default(null),
    })
  ),
  outcome_counts: z.object({
    restore_values: count,
    move_to_deleted: count,
    recreate: count,
    already_reverted: count,
    missing: count,
  }),
})
const restorePreview = z.object({
  string_id: z.string(),
  activity_id: z.string(),
  can_restore: z.boolean(),
  blocked_reason: reason,
  notice: reason,
  already_matches: z.boolean(),
  pending_delete: z.boolean(),
  changes: z.array(change),
})

export class PreviewContractError extends Error {
  constructor() {
    super(
      'The server returned an incompatible preview. Confirmation is unavailable. Retry after the server update.'
    )
    this.name = 'PreviewContractError'
  }
}

export function parseRevertPreview(value: unknown): RevertPreview {
  const result = revertPreview.safeParse(value)
  if (!result.success) throw new PreviewContractError()
  return result.data
}

export function parseRestorePreview(value: unknown): RestorePreview {
  const result = restorePreview.safeParse(value)
  if (!result.success) throw new PreviewContractError()
  return result.data
}
