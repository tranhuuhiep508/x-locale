import { describe, expect, it } from 'vitest'
import type { ActivityChange } from '@/lib/api/types'
import {
  canRestoreHistoryVersion,
  historyRestoreBlockedReason,
  isHistoryRestoreEnabled,
  shouldShowHistoryRestore,
} from '@/features/strings/history-restore'

describe.each(['string.published', 'string.saved_and_published'])(
  'canRestoreHistoryVersion (%s)',
  (publicationEvent) => {
    const contentChange: ActivityChange = {
      field: 'translation',
      before: 'Hello',
      after: 'Welcome',
      scope: 'draft',
      kind: 'translation',
      locale: 'en',
    }

    it('honors server eligibility for mixed publication and clears the blocked reason', () => {
      const activity = {
        action: 'update',
        event_type: publicationEvent,
        is_history_restorable: true,
      }
      expect(canRestoreHistoryVersion(activity)).toBe(true)
      expect(historyRestoreBlockedReason(activity)).toBeNull()
      expect(isHistoryRestoreEnabled(0, activity)).toBe(false)
      expect(isHistoryRestoreEnabled(1, activity)).toBe(true)
    })

    it('keeps a negative server flag authoritative even with content changes', () => {
      expect(
        canRestoreHistoryVersion({
          action: 'update',
          event_type: publicationEvent,
          is_history_restorable: false,
          changed: [contentChange],
        })
      ).toBe(false)
    })

    it.each(['key', 'source_text', 'description', 'module_id', 'tags', 'translation'])(
      'recognizes a mixed publication from a draft %s diff without a server flag',
      (field) => {
        const activity = {
          action: 'update',
          event_type: publicationEvent,
          changed: [{ ...contentChange, field }],
        }
        expect(canRestoreHistoryVersion(activity)).toBe(true)
        expect(historyRestoreBlockedReason(activity)).toBeNull()
      }
    )

    it.each([
      { ...contentChange, scope: 'published' as const },
      { ...contentChange, field: 'status' },
      { ...contentChange, field: 'pending_delete' },
      { ...contentChange, before: 'Welcome' },
    ])('requires evidence of a working-copy edit in fallback diffs: %o', (change) => {
      expect(
        canRestoreHistoryVersion({
          action: 'update',
          event_type: publicationEvent,
          changed: [change],
        })
      ).toBe(false)
    })

    it.each(['string.unpublished', 'string.pending_delete', 'string.deleted'])(
      'keeps %s blocked even with content changes',
      (event_type) => {
        expect(
          canRestoreHistoryVersion({
            action: 'update',
            event_type,
            changed: [contentChange],
          })
        ).toBe(false)
      }
    )

    it('keeps deletion blocked even when the event type indicates publication', () => {
      expect(
        canRestoreHistoryVersion({
          action: 'delete',
          event_type: publicationEvent,
          changed: [contentChange],
        })
      ).toBe(false)
    })

    it('allows content snapshots', () => {
      expect(
        canRestoreHistoryVersion({
          is_history_restorable: true,
          action: 'update',
          event_type: 'translation.updated',
        })
      ).toBe(true)
    })

    it('hides publish, unpublish, and pending delete', () => {
      expect(
        canRestoreHistoryVersion({
          is_history_restorable: false,
          action: 'update',
          event_type: publicationEvent,
        })
      ).toBe(false)
      expect(
        canRestoreHistoryVersion({
          is_history_restorable: false,
          action: 'update',
          event_type: 'string.unpublished',
        })
      ).toBe(false)
      expect(
        canRestoreHistoryVersion({
          is_history_restorable: false,
          action: 'update',
          event_type: 'string.pending_delete',
        })
      ).toBe(false)
    })

    it('falls back to event_type when server flag is absent', () => {
      expect(
        canRestoreHistoryVersion({
          action: 'update',
          event_type: 'translation.updated',
        })
      ).toBe(true)
      expect(
        canRestoreHistoryVersion({
          action: 'update',
          event_type: publicationEvent,
        })
      ).toBe(false)
    })
  }
)

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
        is_history_restorable: true,
        action: 'update',
        event_type: 'translation.updated',
      })
    ).toBe(false)
  })

  it('is enabled on older content snapshots', () => {
    expect(
      isHistoryRestoreEnabled(1, {
        is_history_restorable: true,
        action: 'update',
        event_type: 'translation.updated',
      })
    ).toBe(true)
  })

  it('is disabled on older lifecycle events', () => {
    expect(
      isHistoryRestoreEnabled(1, {
        is_history_restorable: false,
        action: 'update',
        event_type: 'string.published',
      })
    ).toBe(false)
  })
})

describe('historyRestoreBlockedReason', () => {
  it('explains the publication-only restriction when the server reason is absent', () => {
    expect(
      historyRestoreBlockedReason({
        action: 'update',
        event_type: 'string.published',
      })
    ).toMatch(/Publication-only/)
  })

  it('explains why publish/unpublish snapshots cannot be restored', () => {
    const reason = historyRestoreBlockedReason({
      restore_blocked_reason: 'Publish and unpublish cannot be restored from History.',
      action: 'update',
      event_type: 'string.published',
    })
    expect(reason).toMatch(/Publish and unpublish/)
  })

  it('explains why pending deletes cannot be restored', () => {
    const reason = historyRestoreBlockedReason({
      action: 'update',
      event_type: 'string.pending_delete',
    })
    expect(reason).toMatch(/Pending deletes/)
  })

  it('explains why deleted strings cannot be restored', () => {
    const reason = historyRestoreBlockedReason({
      action: 'delete',
      event_type: 'string.deleted',
    })
    expect(reason).toMatch(/Deleted strings/)
  })

  it('returns null for a restorable snapshot', () => {
    expect(
      historyRestoreBlockedReason({
        is_history_restorable: true,
        restore_blocked_reason: null,
        action: 'update',
        event_type: 'translation.updated',
      })
    ).toBeNull()
  })
})
