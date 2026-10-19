import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityPage } from '@/features/activity/ActivityPage'
import { clearActiveJob } from '@/lib/active-job'
import { activitiesApi } from '@/lib/api/activities'
import { ApiError } from '@/lib/api/client'
import { jobsApi } from '@/lib/api/jobs'
import { projectsApi } from '@/lib/api/projects'
import type { ActivityFeedCard, Project, RevertPreview } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}

vi.mock('@/lib/toast', () => ({
  useToast: () => toast,
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useParams: () => ({ projectRef: 'proj-1' }),
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/lib/api/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/activities')>()
  return {
    ...actual,
    activitiesApi: {
      ...actual.activitiesApi,
      feed: vi.fn(),
      revertBatch: vi.fn(),
      revertBatchPreview: vi.fn(),
    },
  }
})

vi.mock('@/lib/api/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/jobs')>()
  return {
    ...actual,
    jobsApi: { get: vi.fn() },
  }
})

vi.mock('@/lib/api/projects', () => ({
  projectsApi: { get: vi.fn() },
}))

const PUBLISHED_KEY_CONFLICT =
  "Key 'save' is already in the public export. Rename it, or publish the other string's removal, before publishing."

const project: Project = {
  id: 'proj-1',
  name: 'Demo',
  slug: 'demo',
  base_language: 'vi',
  target_languages: ['en'],
  layout: 'flat',
  allow_duplicate_keys: false,
  string_count: 1,
  created_at: null,
  updated_at: null,
  role: 'editor',
  translation_context: null,
}

const card: ActivityFeedCard = {
  id: 'card-1',
  kind: 'batch',
  event_type: 'import',
  summary: 'Imported strings',
  actor_type: 'user',
  actor_label: 'dev',
  created_at: '2026-10-18T00:00:00Z',
  string_id: null,
  string_key: null,
  locale: null,
  batch_id: 'batch-1',
  batch_kind: 'import',
  children_count: 2,
  is_undoable: true,
  counts: { updated: 2 },
  changed: [],
  changed_count: 0,
  children: [],
}

const preview: RevertPreview = {
  can_revert: true,
  blocked_reason: null,
  items: [],
  conflicts: [],
  total: 2,
  conflict_count: 0,
  requires_force: false,
  affects_published: true,
  outcome_counts: {
    restore_values: 2,
    move_to_deleted: 0,
    recreate: 0,
    already_reverted: 0,
    missing: 0,
  },
}

const catalogKey = [...queryKeys.projects.strings.all('proj-1'), 'snapshot'] as const
const catalog = [{ id: 'str-1', key: 'save', status: 'draft' }]

function polyfillPointer() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => {},
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => {},
  })
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(queryKeys.projects.detail('proj-1'), project)
  client.setQueryData(catalogKey, catalog)
  const view = render(
    <QueryClientProvider client={client}>
      <ActivityPage />
    </QueryClientProvider>,
  )
  return { client, ...view }
}

async function confirmUndo() {
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  const dialog = await screen.findByRole('alertdialog')
  const confirm = within(dialog).getByRole('button', { name: 'Undo' })
  await waitFor(() => {
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
  })
  fireEvent.click(confirm)
  return dialog
}

function watchCatalog(client: QueryClient) {
  const setData = vi.spyOn(client, 'setQueryData')
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  return () => {
    const writes = [
      ...setData.mock.calls.map((call) => call[0]),
      ...invalidate.mock.calls.map((call) => call[0]),
    ]
    expect(JSON.stringify(writes)).not.toContain('strings')
    expect(client.getQueryData(catalogKey)).toEqual(catalog)
  }
}

describe('Activity undo published_key_conflict', () => {
  beforeEach(() => {
    polyfillPointer()
    clearActiveJob()
    toast.success.mockReset()
    toast.error.mockReset()
    vi.mocked(projectsApi.get).mockReset().mockResolvedValue(project)
    vi.mocked(activitiesApi.feed).mockReset().mockResolvedValue({
      items: [card],
      total: 1,
      page: 1,
      page_size: 20,
    })
    vi.mocked(activitiesApi.revertBatchPreview).mockReset().mockResolvedValue(preview)
    vi.mocked(activitiesApi.revertBatch).mockReset()
    vi.mocked(jobsApi.get).mockReset()
  })

  it('keeps the catalog unchanged and shows the server message on a 409', async () => {
    vi.mocked(activitiesApi.revertBatch).mockRejectedValue(
      new ApiError(409, PUBLISHED_KEY_CONFLICT, {
        detail: {
          code: 'published_key_conflict',
          message: PUBLISHED_KEY_CONFLICT,
          key: 'save',
        },
      }),
    )
    const { client } = renderPage()
    expect(await screen.findByText('Imported strings')).toBeTruthy()
    const catalogUntouched = watchCatalog(client)

    const dialog = await confirmUndo()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(PUBLISHED_KEY_CONFLICT)
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(activitiesApi.revertBatch).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('heading', { name: 'Undo this batch?' })).toBeTruthy()
    expect(screen.getByText('Imported strings')).toBeTruthy()
    catalogUntouched()
  })

  it('shows the server message when the background revert job fails', async () => {
    vi.mocked(activitiesApi.revertBatch).mockResolvedValue({
      job_id: 'job-revert',
      status: 'running',
      kind: 'revert',
    })
    vi.mocked(jobsApi.get).mockResolvedValue({
      id: 'job-revert',
      kind: 'revert',
      status: 'failed',
      result: {
        error: {
          status_code: 409,
          detail: {
            code: 'published_key_conflict',
            message: PUBLISHED_KEY_CONFLICT,
            key: 'save',
          },
        },
      },
      error: 'revert failed',
      created_at: null,
      completed_at: null,
      progress: null,
    })
    const { client } = renderPage()
    expect(await screen.findByText('Imported strings')).toBeTruthy()
    const catalogUntouched = watchCatalog(client)

    const dialog = await confirmUndo()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(PUBLISHED_KEY_CONFLICT)
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(jobsApi.get).toHaveBeenCalledWith('job-revert')
    expect(within(dialog).getByRole('heading', { name: 'Undo this batch?' })).toBeTruthy()
    expect(screen.getByText('Imported strings')).toBeTruthy()
    catalogUntouched()
  })
})
