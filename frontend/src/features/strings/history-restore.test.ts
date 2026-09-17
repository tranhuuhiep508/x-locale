import { describe, expect, it } from 'vitest'
import {
  canRestoreHistoryVersion,
  historyRestoreBlockedReason,
  isHistoryRestoreEnabled,
  shouldShowHistoryRestore,
} from '@/features/strings/history-restore'

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

describe('shouldShowHistoryRestore', () => {
  it('hides restore on the newest event', () => {
    expect(shouldShowHistoryRestore(0)).toBe(false)
  })

  it('shows restore on older events', () => {
    expect(shouldShowHistoryRestore(1)).toBe(true)
  })
})

describe('isHistoryRestoreEnabled', () => {
  it('is disabled on the newest event even when the snapshot is restorable', () => {
    expect(
      isHistoryRestoreEnabled(0, {
        after: { key: 'welcome' },
        action: 'update',
        event_type: 'translation.updated',
      }),
    ).toBe(false)
  })

  it('is enabled on older content snapshots', () => {
    expect(
      isHistoryRestoreEnabled(1, {
        after: { key: 'welcome' },
        action: 'update',
        event_type: 'translation.updated',
      }),
    ).toBe(true)
  })

  it('is disabled on older lifecycle events', () => {
    expect(
      isHistoryRestoreEnabled(1, {
        after: { key: 'welcome', status: 'public' },
        action: 'update',
        event_type: 'string.published',
      }),
    ).toBe(false)
  })
})

describe('historyRestoreBlockedReason', () => {
  it('explains why publish/unpublish snapshots cannot be restored', () => {
    const reason = historyRestoreBlockedReason({
      after: { key: 'k' },
      action: 'update',
      event_type: 'string.published',
    })
    expect(reason).toMatch(/Publish and unpublish/)
  })

  it('explains why pending deletes cannot be restored', () => {
    const reason = historyRestoreBlockedReason({
      after: { key: 'k' },
      action: 'update',
      event_type: 'string.pending_delete',
    })
    expect(reason).toMatch(/Pending deletes/)
  })

  it('explains why deleted strings cannot be restored', () => {
    const reason = historyRestoreBlockedReason({
      after: { key: 'k' },
      action: 'delete',
      event_type: 'string.deleted',
    })
    expect(reason).toMatch(/Deleted strings/)
  })

  it('returns null for a restorable snapshot', () => {
    expect(
      historyRestoreBlockedReason({
        after: { key: 'k' },
        action: 'update',
        event_type: 'translation.updated',
      }),
    ).toBeNull()
  })
})
