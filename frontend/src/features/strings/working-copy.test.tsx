import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StringEntry } from '../../lib/api/types'
import {
  ReleaseBadge,
  WorkingCopyCell,
  canDiscardWorkingCopy,
  fieldChanged,
  isLivePublic,
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
    created_at: '2026-01-01T00:00:00Z',
    created_by_type: null,
    created_by_label: null,
    updated_at: '2026-01-01T00:00:00Z',
    updated_by_type: null,
    updated_by_label: null,
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
  it('marks public unpublished edits as editing', () => {
    expect(
      releaseState(entry({ has_unpublished_changes: true, source_text: 'Lưu ngay' })),
    ).toBe('edited')
  })

  it('stays draft after unpublish even with leftover published_* and edits', () => {
    expect(
      releaseState(
        entry({
          status: 'draft',
          has_unpublished_changes: true,
          source_text: 'Lưu ngay',
        }),
      ),
    ).toBe('draft')
  })

  it('stays draft for never-published strings', () => {
    expect(
      releaseState(
        entry({
          status: 'draft',
          has_unpublished_changes: true,
          published_at: null,
          published_key: null,
          published_source_text: null,
        }),
      ),
    ).toBe('draft')
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

  it('marks in-sync public strings as live', () => {
    expect(releaseState(entry())).toBe('live')
  })
})

describe('fieldChanged', () => {
  it('ignores drafts that were never published', () => {
    expect(fieldChanged('Hello', null, false)).toBe(false)
  })

  it('ignores leftover published snapshot after unpublish', () => {
    const unpublished = entry({
      status: 'draft',
      has_unpublished_changes: true,
      source_text: 'Lưu ngay',
    })
    expect(
      fieldChanged('Lưu ngay', unpublished.published_source_text, isLivePublic(unpublished)),
    ).toBe(false)
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

  it('stays true after unpublish because published_* is kept', () => {
    expect(isReleased(entry({ status: 'draft', has_unpublished_changes: true }))).toBe(true)
  })
})

describe('isLivePublic', () => {
  it('is true only while status is public and the row is not deleted', () => {
    expect(isLivePublic(entry())).toBe(true)
    expect(isLivePublic(entry({ status: 'draft' }))).toBe(false)
    expect(isLivePublic(entry({ deleted_at: '2026-02-01T00:00:00Z' }))).toBe(false)
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

  it('blocks discard after unpublish even if published_* remains', () => {
    expect(
      canDiscardWorkingCopy(
        entry({
          status: 'draft',
          has_unpublished_changes: true,
          source_text: 'Lưu ngay',
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

describe('ReleaseBadge', () => {
  it('shows Editing for public unpublished edits', () => {
    render(
      <ReleaseBadge
        state={releaseState(entry({ has_unpublished_changes: true, source_text: 'Lưu ngay' }))}
      />,
    )
    expect(screen.getByText('Editing')).toBeTruthy()
  })

  it('hides Editing after unpublish even with leftover published_* and edits', () => {
    render(
      <ReleaseBadge
        state={releaseState(
          entry({
            status: 'draft',
            has_unpublished_changes: true,
            source_text: 'Lưu ngay',
          }),
        )}
      />,
    )
    expect(screen.queryByText('Editing')).toBeNull()
  })

  it('hides Editing for a never-published draft', () => {
    render(
      <ReleaseBadge
        state={releaseState(
          entry({
            status: 'draft',
            has_unpublished_changes: true,
            published_at: null,
            published_key: null,
            published_source_text: null,
          }),
        )}
      />,
    )
    expect(screen.queryByText('Editing')).toBeNull()
  })
})

describe('WorkingCopyCell', () => {
  it('omits compare chrome after unpublish', () => {
    const unpublished = entry({
      status: 'draft',
      has_unpublished_changes: true,
      source_text: 'Lưu ngay',
    })
    render(
      <WorkingCopyCell
        working={unpublished.source_text}
        published={unpublished.published_source_text}
        released={isLivePublic(unpublished)}
      />,
    )
    expect(screen.getByText('Lưu ngay')).toBeTruthy()
    expect(screen.queryByLabelText('Compare published and working values')).toBeNull()
  })

  it('shows compare chrome for public unpublished edits', () => {
    const edited = entry({ has_unpublished_changes: true, source_text: 'Lưu ngay' })
    render(
      <WorkingCopyCell
        working={edited.source_text}
        published={edited.published_source_text}
        released={isLivePublic(edited)}
      />,
    )
    expect(screen.getByLabelText('Compare published and working values')).toBeTruthy()
  })
})
