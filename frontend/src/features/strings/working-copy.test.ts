import { describe, expect, it } from 'vitest'
import type { StringEntry } from '../../lib/api/types'
import {
  canDiscardWorkingCopy,
  fieldChanged,
  isReleased,
  liveTranslation,
  releaseRowClassName,
  releaseState,
} from './working-copy'

function entry(overrides: Partial<StringEntry> = {}): StringEntry {
  return {
    id: '1',
    key: 'save',
    source_text: 'Lưu',
    description: null,
    status: 'public',
    pending_delete: false,
    deleted_at: null,
    has_unpublished_changes: false,
    published_at: '2026-01-01T00:00:00Z',
    published_key: 'save',
    published_source_text: 'Lưu',
    published_module_id: null,
    published_module_slug: null,
    module_id: null,
    module_slug: null,
    tags: [],
    updated_at: '2026-01-01T00:00:00Z',
    translations: [
      {
        id: 't1',
        locale: 'en',
        value: 'Save',
        published_value: 'Save',
        confidence: null,
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    ...overrides,
  }
}

describe('releaseState', () => {
  it('marks unpublished edits as editing', () => {
    expect(
      releaseState(entry({ has_unpublished_changes: true, source_text: 'Lưu ngay' })),
    ).toBe('edited')
  })

  it('marks pending delete as removing before edited', () => {
    expect(
      releaseState(
        entry({ pending_delete: true, has_unpublished_changes: true }),
      ),
    ).toBe('removing')
  })

  it('marks tombstones as deleted', () => {
    expect(releaseState(entry({ deleted_at: '2026-02-01T00:00:00Z' }))).toBe('deleted')
  })
})

describe('fieldChanged', () => {
  it('ignores drafts that were never published', () => {
    expect(fieldChanged('Hello', null, false)).toBe(false)
  })

  it('detects working copy drift after publish', () => {
    expect(fieldChanged('Save now', 'Save', true)).toBe(true)
    expect(fieldChanged('Save', 'Save', true)).toBe(false)
  })
})

describe('liveTranslation', () => {
  it('returns the published snapshot, not the working value', () => {
    const edited = entry({
      has_unpublished_changes: true,
      translations: [
        {
          id: 't1',
          locale: 'en',
          value: 'Save now',
          published_value: 'Save',
          confidence: null,
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    })
    expect(liveTranslation(edited, 'en')).toBe('Save')
  })
})

describe('isReleased', () => {
  it('treats a published key as released', () => {
    expect(isReleased(entry({ published_at: null, published_key: 'save' }))).toBe(true)
    expect(
      isReleased(
        entry({
          status: 'draft',
          published_at: null,
          published_key: null,
          published_source_text: null,
        }),
      ),
    ).toBe(false)
  })
})

describe('canDiscardWorkingCopy', () => {
  it('allows discard for published strings with unpublished edits', () => {
    expect(
      canDiscardWorkingCopy(entry({ has_unpublished_changes: true, source_text: 'Lưu 2' })),
    ).toBe(true)
  })

  it('allows discard for pending delete', () => {
    expect(
      canDiscardWorkingCopy(entry({ pending_delete: true, has_unpublished_changes: true })),
    ).toBe(true)
  })

  it('blocks discard for tombstones and never-published drafts', () => {
    expect(canDiscardWorkingCopy(entry({ deleted_at: '2026-02-01T00:00:00Z' }))).toBe(false)
    expect(
      canDiscardWorkingCopy(
        entry({
          status: 'draft',
          published_at: null,
          published_key: null,
          has_unpublished_changes: false,
        }),
      ),
    ).toBe(false)
  })
})

describe('releaseRowClassName', () => {
  it('highlights editing and removing rows', () => {
    expect(releaseRowClassName('edited')).toContain('public-foreground')
    expect(releaseRowClassName('removing')).toContain('destructive')
    expect(releaseRowClassName('draft')).toBeUndefined()
  })
})
