import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { languagesApi, modulesApi, tagsApi } from '@/lib/api/catalog'
import { ApiError } from '@/lib/api/client'
import { jobsApi } from '@/lib/api/jobs'
import { projectsApi } from '@/lib/api/projects'
import { stringsApi } from '@/lib/api/strings'
import type { Project, TranslateProposalItem, TranslateProposalsResult } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { StringsPage } from './StringsPage'

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useParams: () => ({ projectRef: 'demo-app' }),
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
vi.mock('@/lib/api/catalog', () => ({
  languagesApi: { list: vi.fn() },
  modulesApi: { list: vi.fn() },
  tagsApi: { list: vi.fn() },
}))
vi.mock('@/lib/api/projects', () => ({ projectsApi: { get: vi.fn() } }))
vi.mock('@/lib/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/jobs')>(),
  jobsApi: { get: vi.fn() },
}))
vi.mock('@/lib/api/strings', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/strings')>(),
  stringsApi: {
    list: vi.fn(), translateMissing: vi.fn(), translateProposals: vi.fn(), translateApply: vi.fn(),
  },
}))

const project: Project = {
  id: 'demo-id', slug: 'demo-app', name: 'Demo App', base_language: 'vi',
  target_languages: ['en'], layout: 'flat', allow_duplicate_keys: false, string_count: 1,
  created_at: null, updated_at: null, can_change_base_language: false, translation_context: null,
}
const item: TranslateProposalItem = {
  string_id: 'a', key: 'greeting', source_text: 'Xin chào', status: 'draft',
  description: 'Original', translations: { en: '' }, scores: {},
}
const page = { locales: ['en'], items: [item], total: 1, page: 1, page_size: 50, job_id: null }
let client: QueryClient

afterEach(() => {
  cleanup()
  client.clear()
})
beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  vi.mocked(languagesApi.list).mockResolvedValue([])
  vi.mocked(modulesApi.list).mockResolvedValue([])
  vi.mocked(tagsApi.list).mockResolvedValue([])
  vi.mocked(stringsApi.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 })
  vi.mocked(stringsApi.translateMissing).mockResolvedValue(page)
  vi.mocked(stringsApi.translateProposals).mockResolvedValueOnce({
    ...page, items: [{ ...item, description: 'My context', translations: { en: 'Hello' } }],
  })
  vi.mocked(stringsApi.translateApply).mockRejectedValueOnce(new ApiError(409, 'Conflict', {
    detail: { code: 'stale_translation_description', conflicts: [
      { string_id: 'a', key: 'greeting', description: 'New context' },
    ] },
  })).mockResolvedValue({ translated_count: 1, batch_id: 'batch', locales: ['en'] })
})

describe('translation review retranslation', () => {
  it.each([false, true])('preserves Use latest through incomplete results (background: %s)', async (background) => {
    let finishProposals!: (result: TranslateProposalsResult) => void
    const pendingProposals = new Promise<TranslateProposalsResult>((resolve) => { finishProposals = resolve })
    vi.mocked(stringsApi.translateProposals).mockImplementationOnce(() => pendingProposals)
    vi.mocked(jobsApi.get).mockResolvedValue({
      id: 'job', kind: 'translate_proposals', status: 'completed', result: { items: [] },
      error: null, created_at: null, completed_at: null, progress: null,
    })
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    await waitFor(() => expect(vi.mocked(projectsApi.get)).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Translate missing' }))
    await screen.findByLabelText('Description')
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'My context' } })
    fireEvent.click(screen.getByRole('button', { name: /^Translate$/ }))
    await screen.findByLabelText('en')
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'My translation' } })
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use latest' }))
    fireEvent.click(screen.getByRole('button', { name: 'Translate again' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Translate again' })).toBeNull())
    await act(async () => {
      finishProposals({ ...page, items: [], job_id: background ? 'job' : null })
    })
    await waitFor(() => {
      expect(stringsApi.translateProposals).toHaveBeenCalledTimes(2)
      expect((screen.getByRole('button', { name: 'Translate again' }) as HTMLButtonElement).disabled).toBe(false)
    })
    if (background) {
      expect(jobsApi.get).toHaveBeenCalledWith('job')
      // Wait until the page consumes the job result and detaches its observer.
      await waitFor(() => expect(client.getQueryCache().find({
        queryKey: queryKeys.jobs.detail('job'),
      })?.getObserversCount()).toBe(0))
    }
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('New context')
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('My translation')
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
    await waitFor(() => expect(stringsApi.translateApply).toHaveBeenCalledTimes(2))
    const payload = vi.mocked(stringsApi.translateApply).mock.calls[1][1].items[0]
    expect(payload.translations).toEqual({ en: 'My translation' })
    expect(payload).not.toHaveProperty('description')
    expect(payload).not.toHaveProperty('expected_description')
  })
})
