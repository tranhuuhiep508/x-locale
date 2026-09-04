import { describe, expect, it } from 'vitest'
import { canRestoreHistoryVersion } from '@/features/strings/history-restore'

describe('canRestoreHistoryVersion', () => {
  it('allows content snapshots', () => {
    expect(
      canRestoreHistoryVersion({
        after: { key: 'welcome', translations: { en: 'Hello' } },
        action: 'update',
        event_type: 'translation.updated',
      }),
    ).toBe(true)
  })

  it('hides publish, unpublish, and pending delete', () => {
    const after = { key: 'delete', status: 'public' }
    expect(
      canRestoreHistoryVersion({ after, action: 'update', event_type: 'string.published' }),
    ).toBe(false)
    expect(
      canRestoreHistoryVersion({ after, action: 'update', event_type: 'string.unpublished' }),
    ).toBe(false)
    expect(
      canRestoreHistoryVersion({ after, action: 'update', event_type: 'string.pending_delete' }),
    ).toBe(false)
  })
})
