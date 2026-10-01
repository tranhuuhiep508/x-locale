import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stringsApi } from '@/lib/api/strings'
import type { StringEntry } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { useBatchSelection } from './use-batch-selection'

vi.mock('@/lib/api/strings', () => ({
  stringsApi: { publishPreview: vi.fn() },
}))

function entry(id: string, overrides: Partial<StringEntry> = {}): StringEntry {
  return {
    id, key: id, source_text: 'Source', description: null,
    status: 'public', pending_delete: false, deleted_at: null,
    has_unpublished_changes: false, published_at: '2026-01-01T00:00:00Z',
    published_key: id, published_source_text: 'Source',
    published_module_id: null, published_module_slug: null,
    module_id: null, module_slug: null, tags: [], translations: [],
    created_at: null, created_by_type: null, created_by_label: null,
    updated_at: null, updated_by_type: null, updated_by_label: null,
    ...overrides,
  }
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { client, wrapper }
}

describe('useBatchSelection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses current-page rows without an extra request', () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useBatchSelection('p1', { pending: true }, [
      entry('pending', { pending_delete: true }),
    ]), { wrapper })
    expect(result.current.ready).toBe(true)
    expect(result.current.actions.discard_delete).toEqual(['pending'])
    expect(stringsApi.publishPreview).not.toHaveBeenCalled()
  })

  it('loads the full selection after pagination, keeps actions blocked while loading, and updates after invalidation', async () => {
    const { client, wrapper } = setup()
    const pending = entry('pending', { pending_delete: true })
    const deleted = entry('deleted', { deleted_at: '2026-02-01T00:00:00Z' })
    let resolve!: (value: { items: StringEntry[]; fingerprint: string }) => void
    vi.mocked(stringsApi.publishPreview).mockImplementationOnce(() =>
      new Promise((done) => { resolve = done }),
    )
    const { result, rerender } = renderHook(({ rows }) =>
      useBatchSelection('p1', { pending: true, deleted: true }, rows),
      { wrapper, initialProps: { rows: [pending, deleted] } },
    )
    expect(result.current.actions.discard_delete).toEqual(['pending'])
    rerender({ rows: [deleted] })
    expect(result.current.ready).toBe(false)
    expect(result.current.checking).toBe(true)
    await waitFor(() => expect(stringsApi.publishPreview).toHaveBeenCalledWith('p1', {
      string_ids: ['deleted', 'pending'],
    }))
    resolve({ items: [deleted, pending], fingerprint: 'fp' })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.actions.discard_delete).toEqual(['pending'])
    expect(result.current.actions.restore).toEqual(['deleted'])

    vi.mocked(stringsApi.publishPreview).mockResolvedValue({
      items: [deleted, { ...pending, pending_delete: false }], fingerprint: 'fp2',
    })
    await client.invalidateQueries({ queryKey: queryKeys.projects.strings.all('p1') })
    await waitFor(() => expect(result.current.actions.discard_delete).toEqual([]))
  })

  it('does not use the previous selection while a new set is loading', async () => {
    const { wrapper } = setup()
    vi.mocked(stringsApi.publishPreview).mockResolvedValueOnce({
      items: [entry('pending', { pending_delete: true })], fingerprint: 'fp',
    }).mockImplementationOnce(() => new Promise(() => {}))
    const { result, rerender } = renderHook(({ selected }) =>
      useBatchSelection('p1', selected, []),
      { wrapper, initialProps: { selected: { pending: true } as Record<string, boolean> } },
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    rerender({ selected: { deleted: true } })
    expect(result.current.ready).toBe(false)
    expect(result.current.actions.discard_delete).toEqual([])
    expect(result.current.entries).toEqual([])
  })

  it('blocks actions on an off-page read error and supports retry', async () => {
    const { wrapper } = setup()
    vi.mocked(stringsApi.publishPreview).mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ items: [entry('live')], fingerprint: 'fp' })
    const { result } = renderHook(() => useBatchSelection('p1', { live: true }, []), { wrapper })
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.ready).toBe(false)
    await result.current.retry()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.error).toBe(false)
  })
})
