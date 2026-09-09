import { describe, expect, it } from 'vitest'
import type { StringEntry } from '../../lib/api/types'
import {
  buildPublishPreview,
  classifyPublishRow,
  contentFieldChanges,
  hasPublishableChanges,
  previewCountLabel,
  reviewPublishSource,
  searchToBatchFilter,
} from './publish-preview'

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

function draft(overrides: Partial<StringEntry> = {}): StringEntry {
  return entry({
    status: 'draft',
    published_at: null,
    published_key: null,
    published_source_text: null,
    translations: [
      {
        id: 't1',
        locale: 'en',
        value: 'Save',
        published_value: null,
        confidence: null,
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    ...overrides,
  })
}

describe('classifyPublishRow', () => {
  it('shows field diffs for a released string with unpublished changes', () => {
    const row = classifyPublishRow(
      entry({
        has_unpublished_changes: true,
        key: 'save.now',
        source_text: 'Lưu ngay',
        module_slug: 'common',
        published_module_slug: null,
        translations: [
          {
            id: 't1',
            locale: 'en',
            value: 'Save now',
            published_value: 'Save',
            confidence: null,
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 't2',
            locale: 'ja',
            value: '保存',
            published_value: null,
            confidence: null,
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    )
    expect(row.kind).toBe('update')
    expect(row.fields.map((field) => field.field)).toEqual(['key', 'module', 'source', 'en', 'ja'])
    expect(row.fields.find((field) => field.field === 'ja')).toMatchObject({
      working: '保存',
      published: null,
      firstPublish: true,
    })
    expect(row.fields.find((field) => field.field === 'en')).toMatchObject({
      working: 'Save now',
      published: 'Save',
      firstPublish: false,
    })
  })

  it('omits unchanged fields from content updates', () => {
    const fields = contentFieldChanges(
      entry({
        source_text: 'Lưu ngay',
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
      }),
    )
    expect(fields.map((field) => field.field)).toEqual(['source'])
  })

  it('labels empty published values as first publish', () => {
    const fields = contentFieldChanges(
      entry({
        translations: [
          {
            id: 't1',
            locale: 'en',
            value: 'Save',
            published_value: '',
            confidence: null,
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    )
    expect(fields).toEqual([
      {
        field: 'en',
        label: 'EN',
        working: 'Save',
        published: null,
        firstPublish: true,
      },
    ])
  })

  it('treats pending delete as a removal without a content diff', () => {
    const row = classifyPublishRow(
      entry({
        pending_delete: true,
        has_unpublished_changes: true,
        source_text: 'Lưu ngay',
      }),
    )
    expect(row.kind).toBe('removal')
    expect(row.summary).toBe('will remove from public on publish')
    expect(row.fields).toEqual([])
  })

  it('shows never-published drafts as new with working values only', () => {
    const row = classifyPublishRow(
      draft({
        key: 'greet',
        source_text: 'Xin chào',
        module_slug: 'home',
        translations: [
          {
            id: 't1',
            locale: 'en',
            value: 'Hello',
            published_value: null,
            confidence: null,
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 't2',
            locale: 'ja',
            value: '',
            published_value: null,
            confidence: null,
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    )
    expect(row.kind).toBe('new')
    expect(row.summary).toBe('will appear on public')
    expect(row.fields.map((field) => field.field)).toEqual(['key', 'module', 'source', 'en'])
    expect(row.fields.every((field) => field.published === null && field.firstPublish)).toBe(true)
  })

  it('marks in-sync public strings as no-op', () => {
    const row = classifyPublishRow(entry())
    expect(row.kind).toBe('noop')
    expect(row.summary).toBe('Already in sync')
    expect(row.fields).toEqual([])
  })

  it('never treats soft-deleted rows as publishable', () => {
    const row = classifyPublishRow(
      entry({
        deleted_at: '2026-02-01T00:00:00Z',
        has_unpublished_changes: false,
        source_text: 'Lưu ngay',
      }),
    )
    expect(row.kind).toBe('noop')
    expect(row.summary).toBe('Soft-deleted — skipped')
  })

  it('treats unpublished in-sync strings as new to public', () => {
    const row = classifyPublishRow(entry({ status: 'draft' }))
    expect(row.kind).toBe('new')
    expect(row.summary).toBe('will appear on public')
  })
})

describe('buildPublishPreview', () => {
  it('groups rows and counts publishable changes', () => {
    const preview = buildPublishPreview([
      draft({ id: 'new', key: 'hello' }),
      entry({
        id: 'upd',
        key: 'save',
        source_text: 'Lưu ngay',
        has_unpublished_changes: true,
      }),
      entry({
        id: 'del',
        key: 'gone',
        pending_delete: true,
        has_unpublished_changes: true,
      }),
      entry({ id: 'ok', key: 'cancel', published_key: 'cancel', published_source_text: 'Lưu' }),
      entry({
        id: 'tomb',
        key: 'old',
        deleted_at: '2026-02-01T00:00:00Z',
      }),
    ])
    expect(preview.counts).toEqual({ new: 1, update: 1, removal: 1, noop: 2 })
    expect(preview.publishableIds).toEqual(['new', 'upd', 'del'])
    expect(hasPublishableChanges(preview)).toBe(true)
    expect(previewCountLabel(preview.counts)).toBe('1 update · 1 new · 1 removal')
  })

  it('returns an empty publishable set for in-sync and deleted rows', () => {
    const preview = buildPublishPreview([
      entry({ id: 'ok' }),
      entry({ id: 'tomb', deleted_at: '2026-02-01T00:00:00Z' }),
    ])
    expect(hasPublishableChanges(preview)).toBe(false)
    expect(previewCountLabel(preview.counts)).toBe('')
    expect(preview.publishableIds).toEqual([])
  })

  it('uses the example header shape for mixed counts', () => {
    expect(previewCountLabel({ update: 12, new: 3, removal: 1, noop: 4 })).toBe(
      '12 update · 3 new · 1 removal',
    )
  })
})

describe('searchToBatchFilter', () => {
  it('maps needs-publish search onto the batch filter', () => {
    expect(
      searchToBatchFilter({
        module: 'm1',
        tag: 't1',
        q: 'save',
        has_unpublished_changes: true,
      }),
    ).toEqual({
      module_id: 'm1',
      tag_id: 't1',
      q: 'save',
      missing_locale: undefined,
      status: undefined,
      pending_delete: undefined,
      has_unpublished_changes: true,
      deleted: undefined,
      max_confidence: undefined,
    })
  })
})

describe('reviewPublishSource', () => {
  it('uses on-page selection when present', () => {
    const selected = [entry({ id: 'save' })]
    const filter = searchToBatchFilter({ has_unpublished_changes: true })
    expect(reviewPublishSource(selected, filter)).toEqual({ entries: selected })
  })

  it('falls back to the active filter when nothing on the page is selected', () => {
    const filter = searchToBatchFilter({ has_unpublished_changes: true, q: 'save' })
    expect(reviewPublishSource([], filter)).toEqual({ filter })
  })
})
