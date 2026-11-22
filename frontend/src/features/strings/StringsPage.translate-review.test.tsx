import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { languagesApi, modulesApi, tagsApi } from '@/lib/api/catalog'
import { ApiError } from '@/lib/api/client'
import { jobsApi } from '@/lib/api/jobs'
import { projectsApi } from '@/lib/api/projects'
import { stringsApi } from '@/lib/api/strings'
import type { Project, TranslateProposalItem, TranslateProposalsResult, TranslationMemoryMatch } from '@/lib/api/types'
import { StringsPage } from './StringsPage'

// Allow for multi-step translation and job polling under CI load.
configure({ asyncUtilTimeout: 8_000 })
const suiteTimeout = { timeout: 20_000 }

const navigate = vi.hoisted(() => vi.fn())
const useSearch = vi.hoisted(() => vi.fn<() => { q?: string }>())

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useParams: () => ({ projectRef: 'demo-app' }),
    useSearch,
  }),
  useNavigate: () => navigate,
  useLocation: () => undefined,
  useRouter: () => ({}),
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

// A button can render while React Query still reports a pending mutation.
// Wait for it to become actionable so fireEvent does not drop the click.
async function waitUntilEnabled(name: string) {
  return waitFor(() => {
    const button = screen.getByRole<HTMLButtonElement>('button', { name })
    expect(button.disabled).toBe(false)
    return button
  })
}

afterEach(() => {
  cleanup()
  client.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.resetAllMocks()
  useSearch.mockReturnValue({})
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  vi.mocked(languagesApi.list).mockResolvedValue([])
  vi.mocked(modulesApi.list).mockResolvedValue([])
  vi.mocked(tagsApi.list).mockResolvedValue([])
  vi.mocked(stringsApi.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 })
  vi.mocked(stringsApi.translateMissing).mockResolvedValue(page)
  vi.mocked(stringsApi.translateProposals).mockResolvedValueOnce({
    ...page, items: [{ ...item, translations: { en: 'Hello' } }],
  })
  vi.mocked(stringsApi.translateQa).mockResolvedValue({ locale: 'en', issues: [] })
  vi.mocked(stringsApi.translateSave).mockResolvedValue({ action: 'draft', translated_count: 1, string_count: 1, published_count: 0, batch_id: 'batch' })
})

describe('translation review retranslation', suiteTimeout, () => {
  it('shows a quiet memory error without blocking AI or offering a retry button', async () => {
    vi.mocked(stringsApi.translateMissing).mockResolvedValue({ ...page, items: [{ ...item, memory_error: 'Memory unavailable' }] })
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    expect(await screen.findByText('Could not load published translations.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Translate' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(stringsApi.translateMemory).not.toHaveBeenCalled()
  })

  it('keeps the missing translations step visible while the Translate button loads', async () => {
    let finish!: (result: TranslateProposalsResult) => void
    const response = new Promise<TranslateProposalsResult>((resolve) => { finish = resolve })
    vi.mocked(stringsApi.translateProposals).mockReset().mockReturnValue(response)
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    const translate = await waitUntilEnabled('Translate')
    fireEvent.click(translate)
    await waitFor(() => expect(translate.querySelector('[data-slot="spinner"]')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Missing Translations' })).toBeTruthy()
    expect(screen.getByText('Generating translations…').classList.contains('sr-only')).toBe(false)
    await act(async () => { finish({ ...page, items: [{ ...item, translations: { en: 'Hello' } }] }) })
    expect(await screen.findByRole('heading', { name: 'Review Translations' })).toBeTruthy()
  })

  it('applies a memory selection before any generation', async () => {
    vi.mocked(stringsApi.translateMissing).mockResolvedValue({ ...page, items: [{ ...item, memory: { en: [publishedMatch] } }] })
    vi.mocked(stringsApi.translateSave).mockReset().mockResolvedValue({ action: 'draft', translated_count: 1, string_count: 1, published_count: 0, batch_id: 'batch' })
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Translate missing' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use match for en in greeting' }))
    expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Published hello')
    expect((screen.getByRole('button', { name: 'Translate' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    await screen.findByText('AI unavailable')
    expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Published hello')
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
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
    expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Published hello')
    expect(screen.getByRole('button', { name: 'Use match for en in greeting' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(stringsApi.translateProposals).toHaveBeenCalledWith('demo-app', expect.objectContaining({ exclude_cells: { a: ['en'] } })))
    await waitFor(() => expect((screen.getByLabelText('ja') as HTMLTextAreaElement).value).toBe('AI Japanese'))
    expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Published hello')
    fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Translate again' }))
    await waitFor(() => expect(stringsApi.translateProposals).toHaveBeenLastCalledWith('demo-app', expect.objectContaining({ exclude_cells: {} })))
  })

  it('restores the AI proposal after retranslation and deselection', async () => {
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
    fireEvent.click(await waitUntilEnabled('Translate'))
    await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('AI English'))
    fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Translate again' }))
    await waitFor(() => expect((screen.getByLabelText('ja') as HTMLTextAreaElement).value).toBe('New Japanese'))
    expect(stringsApi.translateProposals).toHaveBeenLastCalledWith('demo-app', expect.objectContaining({ exclude_cells: { a: ['en'] } }))
    fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('AI English')
    expect(screen.getByRole('button', { name: 'Use match for en in greeting' }).getAttribute('aria-pressed')).toBe('false')
    expect((screen.getByLabelText('ja') as HTMLTextAreaElement).value).toBe('New Japanese')
    fireEvent.click(screen.getByRole('button', { name: 'Translate again' }))
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
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Add string' })[0])
    expect(await screen.findByRole('menuitem', { name: 'Add many' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add single string' }))
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
      .mockResolvedValueOnce({ ...page, items: [{ ...item, translations: { en: 'Hello' } }] })
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
    fireEvent.click(await waitUntilEnabled('Translate'))
    // The en field is already mounted for the missing queue, so findByLabelText
    // resolves before this click's proposals rename the button.
    await waitUntilEnabled('Translate again')
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'My draft' } })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Translate again' }))
    for (let i = 0; i < 40 && !screen.queryByText(interrupted); i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    }
    expect(screen.getByText(interrupted)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Translate again' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('My draft')
    const polls = vi.mocked(jobsApi.get).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(jobsApi.get).toHaveBeenCalledTimes(polls)
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Translate again' }))
    await waitFor(() => expect(screen.queryByText(interrupted)).toBeNull())
    await act(async () => { finishRetry({ ...page, items: [], job_id: 'retry-job' }) })
    await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Hello'))
    expect(screen.queryByText(interrupted)).toBeNull()
    expect(jobsApi.get).toHaveBeenLastCalledWith('retry-job')
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
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
  fireEvent.click(await waitUntilEnabled('Translate'))
  await waitUntilEnabled('Translate again')
  fireEvent.change(screen.getAllByLabelText('en')[0], { target: { value: 'My stale draft' } })
  fireEvent.change(screen.getAllByLabelText('en')[1], { target: { value: 'Unrelated draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
  await screen.findByText('Source text changed since generation')
  await waitUntilEnabled('Regenerate changed strings')
}

describe('source conflict recovery', suiteTimeout, () => {
  it.each([false, true])('regenerates only affected rows and preserves other drafts (background: %s)', async (background) => {
    await openSourceConflict()
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(true)
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
    await waitFor(() => expect(stringsApi.translateProposals).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Source text changed since generation')).toBeNull())
    expect(vi.mocked(stringsApi.translateProposals).mock.calls[1][1]).toEqual({
      scope: 'strings', string_ids: ['a'], locales: ['en'],
    })
    await waitFor(() => expect((screen.getAllByLabelText('en')[0] as HTMLTextAreaElement).value).toBe('Cancel'))
    expect((screen.getAllByLabelText('en')[1] as HTMLTextAreaElement).value).toBe('Unrelated draft')
    fireEvent.click(await waitUntilEnabled('Save as draft'))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledTimes(2))
    expect(vi.mocked(stringsApi.translateSave).mock.calls[1][1].items).toMatchObject([
      { string_id: 'a', expected_source_text: 'Hủy', translations: { en: 'Cancel' } },
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
    await screen.findByText(outcome.endsWith('empty') ? /No replacement was produced/ : 'Generation unavailable')
    await waitUntilEnabled('Regenerate changed strings')
    expect((screen.getAllByLabelText('en')[0] as HTMLTextAreaElement).value).toBe('My stale draft')
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from review' }))
    expect(screen.queryByText('Source text changed since generation')).toBeNull()
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Unrelated draft')
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
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
    fireEvent.click(await waitUntilEnabled('Regenerate changed strings'))
    await waitFor(() => expect(screen.queryByText('Source text changed since generation')).toBeNull())
    await waitFor(() => expect((screen.getAllByLabelText('en')[0] as HTMLTextAreaElement).value).toBe('Cancel'))
    expect((screen.getAllByLabelText('en')[1] as HTMLTextAreaElement).value).toBe('Unrelated draft')
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('save as draft or publish in place', suiteTimeout, () => {
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
  const emptyPage = { ...page, items: [], total: 0 }

  async function openReview() {
    render(<QueryClientProvider client={client}><TooltipProvider><StringsPage /></TooltipProvider></QueryClientProvider>)
    const opener = await screen.findByRole('button', { name: 'Translate missing' })
    fireEvent.click(opener)
  }

  async function openAndFill() {
    await openReview()
    fireEvent.change(await screen.findByRole('textbox', { name: 'en' }), { target: { value: 'Hello' } })
  }

  it('freezes the reviewed rows, shows the full public diff, and publishes without a second confirmation', async () => {
    let finishReview!: (value: { items: typeof reviewed[]; fingerprint: string }) => void
    const response = new Promise<{ items: typeof reviewed[]; fingerprint: string }>((resolve) => { finishReview = resolve })
    vi.mocked(stringsApi.translateReview).mockReturnValue(response)
    vi.mocked(stringsApi.translateSave).mockReset().mockResolvedValue(published)
    vi.mocked(stringsApi.translateMissing).mockResolvedValueOnce(page).mockResolvedValueOnce(emptyPage)
    await openAndFill()
    const review = screen.getByRole<HTMLButtonElement>('button', { name: 'Review & publish' })
    fireEvent.click(review)
    await waitFor(() => expect(review.querySelector('[data-slot="spinner"]')).toBeTruthy())
    expect(review.disabled).toBe(true)
    expect(screen.getByRole('textbox', { name: 'en' })).toBeTruthy()
    expect(screen.queryByText('Review Publication')).toBeNull()
    await act(async () => { finishReview({ items: [reviewed], fingerprint: 'fp-1' }) })
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
    expect(await screen.findByText('No missing translations remain')).toBeTruthy()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    expect(screen.getByText('Saved and published 1 string. Available on the next public pull or export.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(await waitUntilEnabled('View changes'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(navigate).toHaveBeenCalledTimes(1)
    const { search } = navigate.mock.calls[0][0] as { search: (prev: { page_size?: number }) => unknown }
    expect(search({ page_size: 50 })).toEqual({ page: 1, page_size: 50, batch_id: 'pub', batch_kind: 'translate' })
    expect(stringsApi.translateMissing).toHaveBeenCalledTimes(2)
  })

  it('publishes from page two and starts again at page one of the same queue', async () => {
    const first = { ...item, string_id: 'b', key: 'greeting.first' }
    vi.mocked(stringsApi.translateMissing)
      .mockResolvedValueOnce({ ...page, items: [first], total: 52 })
      .mockResolvedValueOnce({ ...page, total: 52, page: 2 })
      .mockResolvedValueOnce({ ...page, items: [first], total: 51 })
    vi.mocked(stringsApi.translateReview).mockResolvedValue({ items: [reviewed], fingerprint: 'fp' })
    vi.mocked(stringsApi.translateSave).mockResolvedValue(published)
    useSearch.mockReturnValue({ q: 'greeting' })
    await openReview()
    fireEvent.click(await waitUntilEnabled('Next page'))
    await screen.findByRole('group', { name: 'Translations for greeting' })
    fireEvent.change(screen.getByRole('textbox', { name: 'en' }), { target: { value: 'Hello' } })
    fireEvent.click(await waitUntilEnabled('Review & publish'))
    fireEvent.click(await waitUntilEnabled('Publish 1 string'))

    expect(await screen.findByRole('group', { name: 'Translations for greeting.first' })).toBeTruthy()
    await waitUntilEnabled('Translate')
    expect(screen.getByText(/of 51 strings/)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Translations for greeting' })).toBeNull()
    expect(stringsApi.translateMissing).toHaveBeenNthCalledWith(2, 'demo-app', expect.objectContaining({ page: 2, q: 'greeting' }))
    const firstRequest = vi.mocked(stringsApi.translateMissing).mock.calls[0][1]
    expect(stringsApi.translateMissing).toHaveBeenNthCalledWith(3, 'demo-app', firstRequest)
    expect(stringsApi.translateProposals).not.toHaveBeenCalled()
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
    fireEvent.click(await waitUntilEnabled('Publish 1 string'))
    await waitFor(() => expect(stringsApi.translateReview).toHaveBeenCalledTimes(2))
    expect(vi.mocked(stringsApi.translateReview).mock.calls[1]).toEqual(vi.mocked(stringsApi.translateReview).mock.calls[0])
    expect(stringsApi.translateSave).toHaveBeenCalledTimes(1)
    fireEvent.click(await waitUntilEnabled('Publish 1 string'))
    await waitFor(() => expect(vi.mocked(stringsApi.translateSave).mock.calls[1][1].fingerprint).toBe('new'))
  })

  it('keeps edits after a failed save and Back to edit returns to the same drafts', async () => {
    vi.mocked(stringsApi.translateReview).mockResolvedValue({ items: [reviewed], fingerprint: 'fp' })
    vi.mocked(stringsApi.translateSave).mockReset().mockRejectedValue(new Error('Network down'))
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Hello'))
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    await waitUntilEnabled('Publish 1 string')
    fireEvent.click(await waitUntilEnabled('Back to edit'))
    expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Hello')
  })

  it('returns to editing during the initial publication comparison and ignores its late result', async () => {
    const user = userEvent.setup()
    let finishReview!: (value: { items: typeof reviewed[]; fingerprint: string }) => void
    vi.mocked(stringsApi.translateReview).mockImplementationOnce(() => new Promise((resolve) => { finishReview = resolve }))
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    const back = await waitUntilEnabled('Back to edit')
    back.focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(await waitUntilEnabled('Review & publish'))
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'en' })
    expect(input.value).toBe('Hello')
    expect(input.disabled).toBe(false)
    fireEvent.change(input, { target: { value: 'Hello again' } })

    await act(async () => { finishReview({ items: [reviewed], fingerprint: 'stale' }) })
    expect(screen.queryByText('Review Publication')).toBeNull()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'en' }).value).toBe('Hello again')
  })

  it('preserves bulk Undo when cancelling the publication comparison', async () => {
    const matchable = { ...item, memory: { en: [publishedMatch] } }
    vi.mocked(stringsApi.translateMissing).mockResolvedValue({
      ...page, total: 2, items: [matchable, { ...matchable, string_id: 'b', key: 'other' }],
    })
    vi.mocked(stringsApi.translateReview).mockImplementationOnce(() => new Promise(() => {}))
    await openReview()
    fireEvent.click(await waitUntilEnabled('Use 2 exact matches'))
    fireEvent.click(await waitUntilEnabled('Review & publish'))
    fireEvent.click(await waitUntilEnabled('Back to edit'))

    const inputs = screen.getAllByRole<HTMLTextAreaElement>('textbox', { name: 'en' })
    expect(inputs.map((input) => input.value)).toEqual(['Published hello', 'Published hello'])
    fireEvent.click(await waitUntilEnabled('Undo'))
    expect(inputs.map((input) => input.value)).toEqual(['', ''])
  })

  it('keeps Back to edit focused when the publication comparison finishes', async () => {
    const user = userEvent.setup()
    let finishReview!: (value: { items: typeof reviewed[]; fingerprint: string }) => void
    vi.mocked(stringsApi.translateReview).mockImplementationOnce(() => new Promise((resolve) => { finishReview = resolve }))
    await openAndFill()
    fireEvent.click(await waitUntilEnabled('Review & publish'))
    const back = await waitUntilEnabled('Back to edit')
    back.focus()

    await act(async () => { finishReview({ items: [reviewed], fingerprint: 'fp' }) })
    await waitUntilEnabled('Publish 1 string')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to edit' }))
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(await waitUntilEnabled('Review & publish'))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'en' }).value).toBe('Hello')
  })

  it.each([
    { error: new Error('Network unavailable'), from: 'Back to edit', to: 'Review & publish' },
    { error: sourceConflict, from: 'Back to edit', to: 'Regenerate changed strings' },
    { error: new Error('Network unavailable'), from: 'Close', to: 'Close' },
  ])('moves focus from $from to $to when the publication comparison fails', async ({ error, from, to }) => {
    let failReview!: (reason: Error) => void
    vi.mocked(stringsApi.translateReview).mockImplementationOnce(() => new Promise((_, reject) => { failReview = reject }))
    await openAndFill()
    fireEvent.click(await waitUntilEnabled('Review & publish'))
    await waitUntilEnabled('Back to edit')
    const focused = screen.getByRole('button', { name: from })
    focused.focus()
    expect(document.activeElement).toBe(focused)

    await act(async () => { failReview(error) })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to edit' })).toBeNull())
    expect(document.activeElement).toBe(await waitUntilEnabled(to))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'en' }).value).toBe('Hello')
  })

  it('ignores a publication review refresh that resolves after Back to edit', async () => {
    let resolveStale!: (value: { items: typeof reviewed[]; fingerprint: string }) => void
    vi.mocked(stringsApi.translateReview)
      .mockResolvedValueOnce({ items: [reviewed], fingerprint: 'original' })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve }))
      .mockResolvedValueOnce({ items: [reviewed], fingerprint: 'fresh' })
    vi.mocked(stringsApi.translateSave).mockReset()
      .mockRejectedValueOnce(new ApiError(409, 'Conflict', { detail: { code: 'publish_fingerprint_mismatch' } }))
      .mockResolvedValue(published)
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    fireEvent.click(await waitUntilEnabled('Publish 1 string'))
    await waitFor(() => expect(stringsApi.translateReview).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'en' }), { target: { value: 'Hello again' } })
    await act(async () => { resolveStale({ items: [reviewed], fingerprint: 'stale' }) })
    expect(screen.queryByText('Review Publication')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Hello again')
    // A newer review is the only one that can publish.
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish 1 string' }))
    await waitFor(() => expect(stringsApi.translateSave).toHaveBeenCalledTimes(2))
    expect(vi.mocked(stringsApi.translateSave).mock.calls[1][1]).toMatchObject({
      fingerprint: 'fresh', items: [{ translations: { en: 'Hello again' } }],
    })
  })

  it('keeps a partially translated row in the queue and guards later edits before opening the saved batch', async () => {
    const user = userEvent.setup()
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, target_languages: ['en', 'ja'] })
    vi.mocked(stringsApi.translateMissing)
      .mockResolvedValueOnce({ ...page, locales: ['en', 'ja'], items: [{ ...item, translations: { en: '', ja: '' } }] })
      .mockResolvedValueOnce({ ...page, locales: ['en', 'ja'], items: [{ ...item, translations: { ja: '' } }] })
    vi.mocked(stringsApi.translateSave).mockReset().mockResolvedValue({ ...published, action: 'draft', published_count: 0 })
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitUntilEnabled('Translate')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'ja' }).value).toBe('')
    expect(screen.queryByRole('textbox', { name: 'en' })).toBeNull()
    expect(stringsApi.translateSave).toHaveBeenCalledTimes(1)
    expect(stringsApi.translateMissing).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Translations saved as draft. Public translations are unchanged.')).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'ja' }), { target: { value: 'こんにちは' } })
    const viewChanges = await waitUntilEnabled('View changes')
    viewChanges.focus()
    await user.keyboard('{Enter}')
    const keepReviewing = await screen.findByRole('button', { name: 'Keep reviewing' })
    await waitFor(() => expect(document.activeElement).toBe(keepReviewing))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(document.activeElement).toBe(viewChanges))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'ja' }).value).toBe('こんにちは')
    expect(navigate).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    fireEvent.click(screen.getByRole('button', { name: 'Discard and view changes' }))
    const navigation = navigate.mock.calls[0][0]
    expect(navigation.params).toEqual({ projectRef: 'demo-app' })
    expect(navigation.search({ page: 4, q: 'old', status: 'draft', page_size: 20 }))
      .toEqual({ page: 1, page_size: 20, batch_id: 'pub', batch_kind: 'translate' })
  })

  it('retries a failed queue refresh without repeating the successful save', async () => {
    vi.mocked(stringsApi.translateMissing)
      .mockResolvedValueOnce(page)
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce(emptyPage)
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))

    expect(await screen.findByText('Failed to load missing translations')).toBeTruthy()
    expect(screen.getByText('Translations saved as draft. Public translations are unchanged.')).toBeTruthy()
    expect((await waitUntilEnabled('View changes')).closest('[role="dialog"]')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'en' })).toBeNull()
    fireEvent.click(await waitUntilEnabled('Retry'))
    expect(await screen.findByText('No missing translations remain')).toBeTruthy()
    expect(await waitUntilEnabled('View changes')).toBeTruthy()
    expect(stringsApi.translateMissing).toHaveBeenCalledTimes(3)
    expect(stringsApi.translateSave).toHaveBeenCalledTimes(1)
  })

  it('allows retrying a failed page change only at the loaded values after cancelling comparison', async () => {
    const other = { ...item, string_id: 'b', key: 'other' }
    vi.mocked(stringsApi.translateMissing)
      .mockResolvedValueOnce({ ...page, total: 51 })
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce({ ...page, total: 51, page: 2, items: [other] })
    vi.mocked(stringsApi.translateReview).mockImplementationOnce(() => new Promise(() => {}))
    await openReview()
    fireEvent.click(await waitUntilEnabled('Next page'))
    const retry = await waitUntilEnabled('Retry')
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'en' })
    fireEvent.change(input, { target: { value: 'Keep this draft' } })
    expect(retry.disabled).toBe(true)
    fireEvent.click(await waitUntilEnabled('Review & publish'))
    fireEvent.click(await waitUntilEnabled('Back to edit'))
    await waitUntilEnabled('Review & publish')
    expect(input.value).toBe('Keep this draft')

    fireEvent.change(input, { target: { value: '' } })
    expect(retry.disabled).toBe(false)
    fireEvent.change(input, { target: { value: 'Keep this draft' } })
    expect(retry.disabled).toBe(true)
    fireEvent.click(retry)
    expect(stringsApi.translateMissing).toHaveBeenCalledTimes(2)
    expect(input.value).toBe('Keep this draft')

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(await waitUntilEnabled('Retry'))
    expect(await screen.findByRole('group', { name: 'Translations for other' })).toBeTruthy()
    expect((await waitUntilEnabled('Previous page')).getAttribute('aria-disabled')).toBeNull()
    expect(stringsApi.translateMissing).toHaveBeenNthCalledWith(3, 'demo-app', expect.objectContaining({ page: 2 }))
  })

  it('allows retrying a failed page change after clearing a generated locale absent from the loaded page', async () => {
    vi.mocked(projectsApi.get).mockResolvedValue({ ...project, target_languages: ['en', 'ja'] })
    vi.mocked(stringsApi.translateMissing)
      .mockResolvedValueOnce({ ...page, total: 51 })
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce({ ...page, total: 51, page: 2, items: [{ ...item, string_id: 'b', key: 'other' }] })
    vi.mocked(stringsApi.translateProposals).mockReset().mockResolvedValueOnce({
      ...page, locales: ['en', 'ja'], items: [{ ...item, translations: { ja: 'こんにちは' } }],
    })
    await openReview()
    fireEvent.click(await waitUntilEnabled('Next page'))
    const retry = await waitUntilEnabled('Retry')
    fireEvent.click(await waitUntilEnabled('Translate'))
    await waitUntilEnabled('Translate again')
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'ja' })
    expect(input.value).toBe('こんにちは')
    expect(retry.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '' } })
    expect(retry.disabled).toBe(false)
    fireEvent.change(input, { target: { value: ' ' } })
    fireEvent.click(await waitUntilEnabled('Retry'))
    expect(await screen.findByRole('group', { name: 'Translations for other' })).toBeTruthy()
  })

  it('shows cells filled elsewhere and saves nothing', async () => {
    vi.mocked(stringsApi.translateSave).mockReset().mockRejectedValue(new ApiError(409, 'Conflict', {
      detail: { code: 'stale_translation_value', conflicts: [{ string_id: 'a', key: 'greeting', locale: 'en', value: 'Hi' }] },
    }))
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(await screen.findByText(/Filled elsewhere since review: greeting \(EN\)/)).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Hello')
  })

  it('omits View changes when the proposed translations already match the saved values', async () => {
    vi.mocked(stringsApi.translateMissing).mockResolvedValueOnce(page).mockResolvedValueOnce(emptyPage)
    vi.mocked(stringsApi.translateSave).mockResolvedValue({
      ...published, action: 'draft', translated_count: 0, published_count: 0,
    })
    await openAndFill()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await screen.findByRole('button', { name: 'Done' })
    expect(screen.getByText('No translation changes to save')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View changes' })).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })
})
