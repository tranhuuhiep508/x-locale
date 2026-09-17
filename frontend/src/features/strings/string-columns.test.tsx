import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stringsApi } from '@/lib/api/strings'
import type { StringEntry } from '@/lib/api/types'
import { PublishSwitch } from './string-columns'

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}

vi.mock('@/lib/toast', () => ({
  useToast: () => toast,
}))

vi.mock('@/lib/api/strings', () => ({
  stringsApi: {
    batch: vi.fn(),
  },
}))

function publicEntry(overrides: Partial<StringEntry> = {}): StringEntry {
  return {
    id: 'str-1',
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
    translations: [],
    ...overrides,
  }
}

function renderSwitch(entry: StringEntry = publicEntry()) {
  const onRefresh = vi.fn()
  const onPublishPreview = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const ui: ReactNode = (
    <QueryClientProvider client={queryClient}>
      <PublishSwitch
        entry={entry}
        projectId="p1"
        onRefresh={onRefresh}
        onPublishPreview={onPublishPreview}
      />
    </QueryClientProvider>
  )
  return { ...render(ui), onRefresh, onPublishPreview }
}

describe('PublishSwitch unpublish confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Cancel leaves the string public and does not write', async () => {
    renderSwitch()

    fireEvent.click(screen.getByRole('switch', { name: 'Public' }))

    expect(await screen.findByRole('heading', { name: 'Unpublish this string?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Unpublish this string?' })).toBeNull()
    })
    expect(stringsApi.batch).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'Public' })).toBeTruthy()
  })

  it('Confirm unpublishes and shows a success toast with a count', async () => {
    vi.mocked(stringsApi.batch).mockResolvedValue({ affected: 1, batch_id: 'b1' })
    const { onRefresh } = renderSwitch()

    fireEvent.click(screen.getByRole('switch', { name: 'Public' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unpublish' }))

    await waitFor(() => {
      expect(stringsApi.batch).toHaveBeenCalledWith('p1', {
        action: 'unpublish',
        string_ids: ['str-1'],
      })
    })
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Unpublished 1 string')
    })
    expect(onRefresh).toHaveBeenCalled()
  })
})
