import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { languagesApi, modulesApi, tagsApi } from '@/lib/api/catalog'
import { ApiError } from '@/lib/api/client'
import { jobsApi } from '@/lib/api/jobs'
import { projectsApi } from '@/lib/api/projects'
import { stringsApi } from '@/lib/api/strings'
import type { Project, TranslateProposalItem, TranslateProposalsResult, TranslationMemoryMatch } from '@/lib/api/types'
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
    list: vi.fn(), editorSave: vi.fn(), translateMissing: vi.fn(), translateProposals: vi.fn(), translateSave: vi.fn(), translateReview: vi.fn(),
    translateQa: vi.fn(), translateMemory: vi.fn(),
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
const publishedMatch: TranslationMemoryMatch = {
  string_id: 'origin', key: 'published.greeting', module_id: null, module_slug: 'common',
  matched_source_text: 'Xin chào', translation: 'Published hello', exact: true, similarity: 1, issues: [],
}
let client: QueryClient

afterEach(() => {
  cleanup()
  client.clear()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
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
  vi.mocked(stringsApi.translateQa).mockResolvedValue({ locale: 'en', issues: [] })
  vi.mocked(stringsApi.translateSave).mockRejectedValueOnce(new ApiError(409, 'Conflict', {
    detail: { code: 'stale_translation_description', conflicts: [
      { string_id: 'a', key: 'greeting', description: 'New context' },
    ] },
  })).mockResolvedValue({ action: 'draft', translated_count: 1, string_count: 1, published_count: 0, batch_id: 'batch' })
})

describe('translation review retranslation', () => {
  it('shows a quiet memory error without blocking AI or offering a retry button', async () => {
    vi.mocked(stringsApi.translateMissing).mockResolvedValue({ ...page, items: [{ ...item, memory_error: 'Memory unavailable' }] })
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    expect(await screen.findByText('Could not load published translations.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Translate \d+ cells$/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(stringsApi.translateMemory).not.toHaveBeenCalled()
  })
  it('applies a memory selection before any generation', async () => {
    vi.mocked(stringsApi.translateMissing).mockResolvedValue({ ...page, items: [{ ...item, memory: { en: [publishedMatch] } }] })
    vi.mocked(stringsApi.translateSave).mockReset().mockResolvedValue({ action: 'draft', translated_count: 1, string_count: 1, published_count: 0, batch_id: 'batch' })
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use match for en in greeting' }))
    expect(screen.queryByRole('textbox', { name: 'en' })).toBeNull()
    expect(screen.getAllByText('Published hello').length).toBeGreaterThan(1)
    expect((screen.getByRole('button', { name: /^Translate \d+ cells$/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 translation as draft' }))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledWith('demo-app', { action: 'draft', items: [{
      string_id: 'a', expected_source_text: 'Xin chào', translations: { en: 'Published hello' }, scores: {},
    }] }))
    expect(stringsApi.translateProposals).not.toHaveBeenCalled()
  })

  it.each([false, true])('applies accepted memory after AI fails (background: %s)', async (background) => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, target_languages: ['en', 'ja'] })
    const row = { ...item, translations: { en: '', ja: '' }, memory: { en: [publishedMatch] } }
    vi.mocked(stringsApi.translateMissing).mockResolvedValue({ ...page, locales: ['en', 'ja'], items: [row] })
    vi.mocked(stringsApi.translateProposals).mockReset()
    if (background) {
      vi.mocked(stringsApi.translateProposals).mockResolvedValue({ ...page, items: [], job_id: 'failed-job' })
      vi.mocked(jobsApi.get).mockResolvedValue({
        id: 'failed-job', kind: 'translate_proposals', status: 'failed', result: null,
        error: 'AI unavailable', created_at: null, completed_at: null, progress: null,
      })
    } else {
      vi.mocked(stringsApi.translateProposals).mockRejectedValue(new Error('AI unavailable'))
    }
    vi.mocked(stringsApi.translateSave).mockReset().mockResolvedValue({ action: 'draft', translated_count: 1, string_count: 1, published_count: 0, batch_id: 'batch' })
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use match for en in greeting' }))
    fireEvent.click(screen.getByRole('button', { name: /^Translate \d+ cells$/ }))
    await screen.findByText('AI unavailable')
    expect(screen.queryByRole('textbox', { name: 'en' })).toBeNull()
    expect(screen.getAllByText('Published hello').length).toBeGreaterThan(1)
    expect((screen.getByRole('button', { name: 'Save 1 translation as draft' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 translation as draft' }))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledWith('demo-app', { action: 'draft', items: [{
      string_id: 'a', expected_source_text: 'Xin chào', translations: { en: 'Published hello' }, scores: {},
    }] }))
  })

  it('preserves selected and edited memory cells through AI generation for other locales', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, target_languages: ['en', 'ja'] })
    const row = { ...item, translations: { en: '', ja: '' }, memory: { en: [publishedMatch] } }
    vi.mocked(stringsApi.translateMissing).mockResolvedValue({ ...page, locales: ['en', 'ja'], items: [row] })
    vi.mocked(stringsApi.translateProposals).mockReset().mockResolvedValue({ ...page, locales: ['en', 'ja'], items: [{ ...item, translations: { ja: 'AI Japanese' }, scores: { ja: 80 } }] })
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use match for en in greeting' }))
    expect(screen.queryByRole('textbox', { name: 'en' })).toBeNull()
    expect(screen.getByText('Skipped · using match')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Translate \d+ cells$/ }))
    await waitFor(() => expect(stringsApi.translateProposals).toHaveBeenCalledWith('demo-app', expect.objectContaining({ exclude_cells: { a: ['en'] } })))
    await waitFor(() => expect((screen.getByLabelText('ja') as HTMLTextAreaElement).value).toBe('AI Japanese'))
    expect(screen.queryByRole('textbox', { name: 'en' })).toBeNull()
    expect(screen.getAllByText('Published hello').length).toBeGreaterThan(1)
    fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /^Translate again/ }))
    await waitFor(() => expect(stringsApi.translateProposals).toHaveBeenLastCalledWith('demo-app', expect.objectContaining({ exclude_cells: {} })))
  })

  it.each([false, true])('restores the AI proposal after retranslation and deselection (alternative match: %s)', async (alternative) => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, target_languages: ['en', 'ja'] })
    const row = { ...item, translations: { en: '', ja: '' }, memory: { en: [
      publishedMatch,
      { ...publishedMatch, string_id: 'other', key: 'other.greeting', translation: 'Another hello' },
    ] } }
    vi.mocked(stringsApi.translateMissing).mockResolvedValue({ ...page, locales: ['en', 'ja'], items: [row] })
    vi.mocked(stringsApi.translateProposals).mockReset()
      .mockResolvedValue({ ...page, items: [] })
      .mockResolvedValueOnce({ ...page, items: [{ ...row, translations: { en: 'AI English', ja: 'AI Japanese' }, scores: { en: 90 } }] })
      .mockResolvedValueOnce({ ...page, items: [{ ...row, translations: { ja: 'New Japanese' }, scores: { ja: 80 } }] })
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Translate 2 cells' }))
    await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('AI English'))
    fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Translate again · 1 cells' }))
    await waitFor(() => expect((screen.getByLabelText('ja') as HTMLTextAreaElement).value).toBe('New Japanese'))
    expect(stringsApi.translateProposals).toHaveBeenLastCalledWith('demo-app', expect.objectContaining({ exclude_cells: { a: ['en'] } }))
    fireEvent.click(screen.getByRole('button', { name: 'Compare en matches for greeting' }))
    expect(screen.getByText('AI English')).toBeTruthy()
    if (alternative) fireEvent.click(screen.getByRole('button', { name: 'Use en match from other.greeting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('AI English')
    expect(screen.getByRole('button', { name: 'Use match for en in greeting' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByLabelText(/Model estimate 90\/100/).length).toBeGreaterThan(0)
    expect((screen.getByLabelText('ja') as HTMLTextAreaElement).value).toBe('New Japanese')
    fireEvent.click(screen.getByRole('button', { name: 'Translate again · 2 cells' }))
    await waitFor(() => expect(stringsApi.translateProposals).toHaveBeenLastCalledWith('demo-app', expect.objectContaining({ exclude_cells: {} })))
  })

  it('excludes a legacy base target from AI selections and editor saves', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, target_languages: ['vi', 'en'] })
    vi.mocked(stringsApi.editorSave).mockResolvedValue({ id: 'saved-string', key: 'save' } as Awaited<ReturnType<typeof stringsApi.editorSave>>)
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    await screen.findByText('0 strings · 1 target language')
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    await waitFor(() => expect(stringsApi.translateMissing).toHaveBeenCalledWith(
      'demo-app', expect.objectContaining({ locales: ['en'] }),
    ))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Add string' })[0])
    fireEvent.change(await screen.findByLabelText('Key'), { target: { value: 'save' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Lưu' } })
    expect(screen.queryByLabelText(/^vi$/i)).toBeNull()
    fireEvent.change(screen.getByLabelText(/^en$/i), { target: { value: 'Save' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(stringsApi.editorSave).toHaveBeenCalledWith(
      'demo-app', { action: 'save_draft', proposal: { mode: 'create', values: expect.objectContaining({ source_text: 'Lưu', translations: { en: 'Save' } }) } },
    ))
  })

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
    fireEvent.click(screen.getByRole('button', { name: /^Translate \d+ cells$/ }))
    fireEvent.change(await screen.findByLabelText('en'), { target: { value: 'My draft' } })
    fireEvent.click(screen.getByRole('button', { name: /^Translate again/ }))
    await screen.findByText(interrupted)
    expect((screen.getByRole('button', { name: /^Translate again/ }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('My draft')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)) })
    expect(jobsApi.get).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /^Translate again/ }))
    await waitFor(() => expect(screen.queryByText(interrupted)).toBeNull())
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('My context')
    expect(vi.mocked(stringsApi.translateProposals).mock.calls[2][1].descriptions).toEqual({ a: 'My context' })
    await act(async () => { finishRetry({ ...page, items: [], job_id: 'retry-job' }) })
    await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Hello'))
    expect(screen.queryByText(interrupted)).toBeNull()
    expect(jobsApi.get).toHaveBeenLastCalledWith('retry-job')
    expect((screen.getByRole('button', { name: /^Save .* as draft$/ }) as HTMLButtonElement).disabled).toBe(false)
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
    fireEvent.click(screen.getByRole('button', { name: /^Translate \d+ cells$/ }))
    await screen.findByLabelText('en')
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'My translation' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save .* as draft$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use latest' }))
    fireEvent.click(screen.getByRole('button', { name: /^Translate again/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Translate again/ })).toBeNull())
    await act(async () => {
      finishProposals({ ...page, items: [], job_id: background ? 'job' : null })
    })
    await waitFor(() => {
      expect(stringsApi.translateProposals).toHaveBeenCalledTimes(2)
      expect((screen.getByRole('button', { name: /^Translate again/ }) as HTMLButtonElement).disabled).toBe(false)
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
    fireEvent.click(screen.getByRole('button', { name: /^Save .* as draft$/ }))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledTimes(2))
    const payload = vi.mocked(stringsApi.translateSave).mock.calls[1][1].items[0]
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
  vi.mocked(stringsApi.translateSave).mockReset().mockRejectedValueOnce(sourceConflict)
    .mockResolvedValue({ action: 'draft', translated_count: 2, string_count: 2, published_count: 0, batch_id: 'batch' })
  render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
  await screen.findAllByLabelText('Description')
  fireEvent.click(screen.getByRole('button', { name: /^Translate \d+ cells$/ }))
  await screen.findAllByLabelText('en')
  fireEvent.change(screen.getAllByLabelText('en')[0], { target: { value: 'My stale draft' } })
  fireEvent.change(screen.getAllByLabelText('en')[1], { target: { value: 'Unrelated draft' } })
  fireEvent.change(screen.getAllByLabelText('Description')[0], { target: { value: 'My context' } })
  fireEvent.click(screen.getByRole('button', { name: /^Save .* as draft$/ }))
  await screen.findByText('Source text changed since generation')
}

describe('source conflict recovery', () => {
  it.each([false, true])('regenerates only affected rows and preserves other drafts (background: %s)', async (background) => {
    await openSourceConflict()
    expect((screen.getByRole('button', { name: /^Save .* as draft$/ }) as HTMLButtonElement).disabled).toBe(true)
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
    fireEvent.click(screen.getByRole('button', { name: /^Save .* as draft$/ }))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledTimes(2))
    expect(vi.mocked(stringsApi.translateSave).mock.calls[1][1].items).toMatchObject([
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
    expect((screen.getByRole('button', { name: /^Save .* as draft$/ }) as HTMLButtonElement).disabled).toBe(true)
    if (outcome.endsWith('empty')) expect(screen.getByText(/No replacement was produced/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from review' }))
    expect(screen.queryByText('Source text changed since generation')).toBeNull()
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Unrelated draft')
    expect((screen.getByRole('button', { name: /^Save .* as draft$/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /^Save .* as draft$/ }))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledTimes(2))
    expect(vi.mocked(stringsApi.translateSave).mock.calls[1][1].items).toHaveLength(1)
    expect(vi.mocked(stringsApi.translateSave).mock.calls[1][1].items[0].string_id).toBe('b')
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
    expect((screen.getByRole('button', { name: /^Save .* as draft$/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('save as draft or publish in place', () => {
  const reviewed = {
    id: 'a', key: 'greeting', source_text: 'Xin chào', description: 'Original', status: 'public' as const,
    pending_delete: false, deleted_at: null, has_unpublished_changes: true, published_at: null,
    published_key: 'greeting', published_source_text: 'Xin chào', published_module_id: null,
    published_module_slug: null, module_id: null, module_slug: null, tags: [],
    created_at: null, created_by_type: null, created_by_label: null,
    updated_at: null, updated_by_type: null, updated_by_label: null,
    translations: [
      { id: null, locale: 'en', value: 'Hello', published_value: '', confidence: null, updated_at: null },
      { id: null, locale: 'fr', value: 'Bonjour', published_value: 'Salut', confidence: null, updated_at: null },
      { id: null, locale: 'ja', value: '', published_value: null, confidence: null, updated_at: null },
    ],
  }
  const published = { action: 'publish' as const, translated_count: 1, string_count: 1, published_count: 1, batch_id: 'pub' }

  async function openAndFill() {
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'en' }), { target: { value: 'Hello' } })
  }

  it('freezes the reviewed rows, shows the full public diff, and publishes without a second confirmation', async () => {
    vi.mocked(stringsApi.translateReview).mockResolvedValue({ items: [reviewed], fingerprint: 'fp-1' })
    vi.mocked(stringsApi.translateSave).mockReset().mockResolvedValue(published)
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    expect(await screen.findByText('Review Publication')).toBeTruthy()
    expect(stringsApi.translateReview).toHaveBeenCalledWith('demo-app', { items: [{
      string_id: 'a', expected_source_text: 'Xin chào', translations: { en: 'Hello' }, scores: {},
    }] })
    // Pending edits in other locales of the same string and empty locales are visible.
    expect(screen.getByText('Bonjour')).toBeTruthy()
    expect(screen.getByText('Salut')).toBeTruthy()
    expect(screen.getByText('1 string has empty locales')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'en' })).toBeNull()
    expect(stringsApi.translateSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1 string' }))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledWith('demo-app', {
      action: 'publish', fingerprint: 'fp-1',
      items: [{ string_id: 'a', expected_source_text: 'Xin chào', translations: { en: 'Hello' }, scores: {} }],
    }))
    // Stays on the review screen with optional navigation.
    expect(await screen.findByRole('button', { name: 'View in Strings' })).toBeTruthy()
    expect(screen.getByText('Missing Translations')).toBeTruthy()
    expect(stringsApi.translateMissing).toHaveBeenCalledTimes(2)
  })

  it('reloads the review instead of publishing when content changed after review', async () => {
    vi.mocked(stringsApi.translateReview)
      .mockResolvedValueOnce({ items: [reviewed], fingerprint: 'old' })
      .mockResolvedValueOnce({ items: [reviewed], fingerprint: 'new' })
    vi.mocked(stringsApi.translateSave).mockReset()
      .mockRejectedValueOnce(new ApiError(409, 'Conflict', { detail: { code: 'publish_fingerprint_mismatch' } }))
      .mockResolvedValue(published)
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish 1 string' }))
    await waitFor(() => expect(stringsApi.translateReview).toHaveBeenCalledTimes(2))
    expect(vi.mocked(stringsApi.translateReview).mock.calls[1]).toEqual(vi.mocked(stringsApi.translateReview).mock.calls[0])
    expect(stringsApi.translateSave).toHaveBeenCalledTimes(1)
    fireEvent.click(await screen.findByRole('button', { name: 'Publish 1 string' }))
    await waitFor(() => expect(vi.mocked(stringsApi.translateSave).mock.calls[1][1].fingerprint).toBe('new'))
  })

  it('keeps edits after a failed save and Back to edit returns to the same drafts', async () => {
    vi.mocked(stringsApi.translateReview).mockResolvedValue({ items: [reviewed], fingerprint: 'fp' })
    vi.mocked(stringsApi.translateSave).mockReset().mockRejectedValue(new Error('Network down'))
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 translation as draft' }))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Hello'))
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to edit' }))
    expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Hello')
  })

  it('retries only the read when the list refresh fails after a successful save', async () => {
    vi.mocked(stringsApi.translateSave).mockReset().mockResolvedValue({ ...published, action: 'draft', published_count: 0 })
    await openAndFill()
    vi.mocked(stringsApi.translateMissing).mockRejectedValueOnce(new Error('Gateway timeout'))
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 translation as draft' }))
    expect(await screen.findByText('Saved, but the list could not refresh')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(stringsApi.translateMissing).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.queryByText('Saved, but the list could not refresh')).toBeNull())
    expect(stringsApi.translateSave).toHaveBeenCalledTimes(1)
  })

  it('shows cells filled elsewhere and saves nothing', async () => {
    vi.mocked(stringsApi.translateSave).mockReset().mockRejectedValue(new ApiError(409, 'Conflict', {
      detail: { code: 'stale_translation_value', conflicts: [{ string_id: 'a', key: 'greeting', locale: 'en', value: 'Hi' }] },
    }))
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 translation as draft' }))
    expect(await screen.findByText(/Filled elsewhere since review: greeting \(EN\)/)).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Hello')
  })
})
