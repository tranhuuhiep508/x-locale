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
  it('stops polling an interrupted job and clears its error on retry while preserving drafts', async () => {
    const interrupted = 'This operation was interrupted by a server restart or lost worker. Please run it again.'
    let finishRetry!: (result: TranslateProposalsResult) => void
    const retryResponse = new Promise<TranslateProposalsResult>((resolve) => { finishRetry = resolve })
    vi.mocked(stringsApi.translateProposals).mockReset()
      .mockResolvedValueOnce({ ...page, items: [{ ...item, description: 'My context', translations: { en: 'Hello' } }] })
      .mockResolvedValueOnce({ ...page, items: [], job_id: 'interrupted-job' })
      .mockImplementationOnce(() => retryResponse)
    vi.mocked(jobsApi.get).mockResolvedValueOnce({
      id: 'interrupted-job', kind: 'translate_proposals', status: 'failed', result: null,
      error: interrupted, created_at: null, completed_at: null, progress: { phase: 'failed', chunks_done: 0, chunks_total: 1 },
    }).mockResolvedValueOnce({
      id: 'retry-job', kind: 'translate_proposals', status: 'completed',
      result: { items: [{ ...item, translations: { en: 'Hello' } }] },
      error: null, created_at: null, completed_at: null, progress: null,
    })
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'My context' } })
    fireEvent.click(screen.getByRole('button', { name: /^Translate$/ }))
    fireEvent.change(await screen.findByLabelText('en'), { target: { value: 'My draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Translate again' }))
    await screen.findByText(interrupted)
    expect((screen.getByRole('button', { name: 'Translate again' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('My draft')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)) })
    expect(jobsApi.get).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Translate again' }))
    await waitFor(() => expect(screen.queryByText(interrupted)).toBeNull())
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('My context')
    expect(vi.mocked(stringsApi.translateProposals).mock.calls[2][1].descriptions).toEqual({ a: 'My context' })
    await act(async () => { finishRetry({ ...page, items: [], job_id: 'retry-job' }) })
    await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Hello'))
    expect(screen.queryByText(interrupted)).toBeNull()
    expect(jobsApi.get).toHaveBeenLastCalledWith('retry-job')
    expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false)
  })

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

const sourceConflict = new ApiError(409, 'Source changed', {
  detail: { code: 'stale_translation_source', conflicts: [
    { string_id: 'a', key: 'greeting', expected_source_text: 'Xin chào', source_text: 'Hủy' },
  ] },
})

async function openSourceConflict() {
  const other = { ...item, string_id: 'b', key: 'other' }
  vi.mocked(stringsApi.translateMissing).mockResolvedValue({ ...page, total: 2, items: [item, other] })
  vi.mocked(stringsApi.translateProposals).mockReset().mockResolvedValueOnce({
    ...page, items: [item, other].map((row) => ({ ...row, translations: { en: 'Generated' } })),
  })
  vi.mocked(stringsApi.translateApply).mockReset().mockRejectedValueOnce(sourceConflict)
    .mockResolvedValue({ translated_count: 2, batch_id: 'batch', locales: ['en'] })
  render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
  await screen.findAllByLabelText('Description')
  fireEvent.click(screen.getByRole('button', { name: /^Translate$/ }))
  await screen.findAllByLabelText('en')
  fireEvent.change(screen.getAllByLabelText('en')[0], { target: { value: 'My stale draft' } })
  fireEvent.change(screen.getAllByLabelText('en')[1], { target: { value: 'Unrelated draft' } })
  fireEvent.change(screen.getAllByLabelText('Description')[0], { target: { value: 'My context' } })
  fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
  await screen.findByText('Source text changed since generation')
}

describe('source conflict recovery', () => {
  it.each([false, true])('regenerates only affected rows and preserves other drafts (background: %s)', async (background) => {
    await openSourceConflict()
    expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByLabelText('en')[0] as HTMLTextAreaElement).value).toBe('My stale draft')
    expect((screen.getAllByLabelText('en')[1] as HTMLTextAreaElement).value).toBe('Unrelated draft')
    expect(screen.getByText('Latest saved source: Hủy')).toBeTruthy()
    const replacement = { ...item, source_text: 'Hủy', description: 'Server context', translations: { en: 'Cancel' }, scores: { en: 80 } }
    vi.mocked(stringsApi.translateProposals).mockResolvedValueOnce({
      ...page, items: background ? [] : [replacement], job_id: background ? 'source-job' : null,
    })
    vi.mocked(jobsApi.get).mockResolvedValue({
      id: 'source-job', kind: 'translate_proposals', status: 'completed', result: { items: [replacement] },
      error: null, created_at: null, completed_at: null, progress: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate changed strings' }))
    await waitFor(() => expect(screen.queryByText('Source text changed since generation')).toBeNull())
    expect(vi.mocked(stringsApi.translateProposals).mock.calls[1][1]).toEqual({
      scope: 'strings', string_ids: ['a'], locales: ['en'], descriptions: { a: 'My context' },
    })
    await waitFor(() => expect((screen.getAllByLabelText('en')[0] as HTMLTextAreaElement).value).toBe('Cancel'))
    expect((screen.getAllByLabelText('en')[1] as HTMLTextAreaElement).value).toBe('Unrelated draft')
    expect((screen.getAllByLabelText('Description')[0] as HTMLTextAreaElement).value).toBe('My context')
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
    await waitFor(() => expect(stringsApi.translateApply).toHaveBeenCalledTimes(2))
    expect(vi.mocked(stringsApi.translateApply).mock.calls[1][1].items).toMatchObject([
      { string_id: 'a', expected_source_text: 'Hủy', translations: { en: 'Cancel' }, expected_description: 'Original', description: 'My context' },
      { string_id: 'b', expected_source_text: 'Xin chào', translations: { en: 'Unrelated draft' } },
    ])
  })

  it.each(['empty', 'background empty', 'failure', 'background failure'] as const)('keeps drafts after %s and allows removal', async (outcome) => {
    await openSourceConflict()
    if (outcome === 'failure') {
      vi.mocked(stringsApi.translateProposals).mockRejectedValueOnce(new Error('Generation unavailable'))
    } else {
      vi.mocked(stringsApi.translateProposals).mockResolvedValueOnce({ ...page, items: [], job_id: outcome.startsWith('background') ? 'recovery-job' : null })
      vi.mocked(jobsApi.get).mockResolvedValue({
        id: 'recovery-job', kind: 'translate_proposals', status: outcome === 'background failure' ? 'failed' : 'completed',
        result: { items: [] }, error: outcome === 'background failure' ? 'Generation unavailable' : null,
        created_at: null, completed_at: null, progress: null,
      })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate changed strings' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Regenerate changed strings' }) as HTMLButtonElement).disabled).toBe(false))
    expect((screen.getAllByLabelText('en')[0] as HTMLTextAreaElement).value).toBe('My stale draft')
    expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(true)
    if (outcome.endsWith('empty')) expect(screen.getByText(/No replacement was produced/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from review' }))
    expect(screen.queryByText('Source text changed since generation')).toBeNull()
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Unrelated draft')
    expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
    await waitFor(() => expect(stringsApi.translateApply).toHaveBeenCalledTimes(2))
    expect(vi.mocked(stringsApi.translateApply).mock.calls[1][1].items).toHaveLength(1)
    expect(vi.mocked(stringsApi.translateApply).mock.calls[1][1].items[0].string_id).toBe('b')
  })

  it('retries failed regeneration without losing either row draft', async () => {
    await openSourceConflict()
    vi.mocked(stringsApi.translateProposals).mockRejectedValueOnce(new Error('Try again'))
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate changed strings' }))
    await screen.findByText('Try again')
    expect((screen.getAllByLabelText('en')[0] as HTMLTextAreaElement).value).toBe('My stale draft')
    vi.mocked(stringsApi.translateProposals).mockResolvedValueOnce({
      ...page, items: [{ ...item, source_text: 'Hủy', translations: { en: 'Cancel' } }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate changed strings' }))
    await waitFor(() => expect(screen.queryByText('Source text changed since generation')).toBeNull())
    await waitFor(() => expect((screen.getAllByLabelText('en')[0] as HTMLTextAreaElement).value).toBe('Cancel'))
    expect((screen.getAllByLabelText('en')[1] as HTMLTextAreaElement).value).toBe('Unrelated draft')
    expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
