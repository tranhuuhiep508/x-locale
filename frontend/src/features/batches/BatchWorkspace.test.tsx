import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BatchWorkspace } from './BatchWorkspace'
import { stringsApi } from '@/lib/api/strings'
import { jobsApi } from '@/lib/api/jobs'
import { ApiError } from '@/lib/api/client'
import { projectQuery } from '@/lib/queries'
import type { CliPushBatch, Project, StringEntry, TranslateProposalItem } from '@/lib/api/types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useBlocker: vi.fn(),
}))
vi.mock('@/lib/api/strings', () => ({
  stringsApi: {
    cliPushBatch: vi.fn(),
    update: vi.fn(),
    translateProposals: vi.fn(),
    translateApply: vi.fn(),
    batch: vi.fn(),
  },
}))
vi.mock('@/lib/api/jobs', async (original) => ({
  ...(await original<typeof import('@/lib/api/jobs')>()),
  jobsApi: { get: vi.fn() },
}))
vi.mock('@/features/strings/use-qa-watch', () => ({ useQaWatch: () => ({}) }))

const project: Project = {
  id: 'p',
  slug: 'demo',
  name: 'Demo',
  base_language: 'vi',
  target_languages: ['en', 'ja'],
  layout: 'flat',
  allow_duplicate_keys: false,
  string_count: 1,
  created_at: null,
  updated_at: null,
  can_change_base_language: false,
  translation_context: null,
}
const entry = (i = 0): StringEntry => ({
  id: `s${i}`,
  key: `login.${i}`,
  source_text: 'Nguồn mới',
  description: null,
  status: 'public',
  pending_delete: false,
  deleted_at: null,
  has_unpublished_changes: true,
  published_at: null,
  published_key: `login.${i}`,
  published_source_text: 'Nguồn cũ',
  published_module_id: null,
  published_module_slug: null,
  module_id: null,
  module_slug: null,
  tags: [],
  created_at: null,
  created_by_type: null,
  created_by_label: null,
  updated_at: null,
  updated_by_type: null,
  updated_by_label: null,
  translations: [
    {
      id: null,
      updated_at: null,
      locale: 'en',
      value: 'Old',
      published_value: 'Old',
      confidence: null,
    },
    {
      id: null,
      updated_at: null,
      locale: 'ja',
      value: '既存',
      published_value: '既存',
      confidence: null,
    },
  ],
})
const proposal = (i = 0): TranslateProposalItem => ({
  string_id: `s${i}`,
  key: `login.${i}`,
  source_text: 'Nguồn mới',
  status: 'public',
  translations: { en: 'Generated' },
  expected_translations: { en: 'Old' },
  scores: { en: 90 },
})
let batch: CliPushBatch
let qc: QueryClient
function show() {
  qc.setQueryData(projectQuery('demo').queryKey, project)
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <BatchWorkspace projectRef="demo" batchId="push" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
async function loaded() {
  await screen.findByText('1 strings in this batch')
}
beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  batch = {
    items: [entry()],
    fingerprint: 'reviewed',
    batch_id: 'push',
    actor_label: 'Dev User',
    created_at: null,
    created_count: 0,
    updated_count: 1,
    excluded_count: 0,
  }
  vi.mocked(stringsApi.cliPushBatch).mockImplementation(async () => structuredClone(batch))
  vi.mocked(stringsApi.update).mockResolvedValue(entry())
  vi.mocked(stringsApi.translateProposals).mockResolvedValue({
    items: [proposal()],
    locales: ['en'],
    job_id: null,
    total: 1,
    page: 1,
    page_size: 50,
  })
  vi.mocked(stringsApi.translateApply).mockResolvedValue({
    translated_count: 1,
    locales: ['en'],
    batch_id: 'translation',
  })
  vi.mocked(stringsApi.batch).mockResolvedValue({ affected: 1, batch_id: 'published' })
})
afterEach(() => {
  cleanup()
  qc.clear()
})

it('shows working and published values for all locales without automatic publication', async () => {
  show()
  await loaded()
  expect(screen.getByText('Nguồn cũ')).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'EN translation for login.0' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'JA translation for login.0' })).toBeTruthy()
  expect(stringsApi.batch).not.toHaveBeenCalled()
})
it('regenerates selected languages within the original batch and applies baselines automatically', async () => {
  show()
  await loaded()
  fireEvent.click(screen.getByRole('checkbox', { name: 'JA' }))
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await waitFor(() => expect(stringsApi.translateApply).toHaveBeenCalledTimes(1))
  expect(stringsApi.translateProposals).toHaveBeenCalledWith(
    'demo',
    expect.objectContaining({
      batch_id: 'push',
      overwrite: true,
      locales: ['en'],
      pending_delete: false,
      deleted: false,
    })
  )
  expect(stringsApi.translateApply).toHaveBeenCalledWith('demo', {
    overwrite: true,
    items: [
      expect.objectContaining({
        string_id: 's0',
        expected_translations: { en: 'Old' },
        translations: { en: 'Generated' },
      }),
    ],
  })
  expect(stringsApi.batch).not.toHaveBeenCalled()
})
it('saves on blur with original source and target checks, then publishes without a second dialog', async () => {
  show()
  await loaded()
  const field = screen.getByRole('textbox', { name: 'EN translation for login.0' })
  fireEvent.change(field, { target: { value: 'Human edit' } })
  expect(
    (screen.getByRole('button', { name: /Publish batch/ }) as HTMLButtonElement).disabled
  ).toBe(true)
  fireEvent.blur(field)
  await waitFor(() =>
    expect(stringsApi.update).toHaveBeenCalledWith('demo', 's0', {
      translations: { en: 'Human edit' },
      expected: { source_text: 'Nguồn mới', translations: { en: 'Old' } },
    })
  )
  await screen.findByText(/Saved to working copy/)
  fireEvent.click(screen.getByRole('button', { name: /Publish batch/ }))
  await waitFor(() =>
    expect(stringsApi.batch).toHaveBeenCalledWith('demo', {
      action: 'publish',
      fingerprint: 'reviewed',
      filter: { batch_id: 'push', deleted: false, pending_delete: false },
    })
  )
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('retains text after a failed save and keeps publish disabled', async () => {
  vi.mocked(stringsApi.update).mockRejectedValue(new ApiError(409, 'Competing translation'))
  show()
  await loaded()
  const field = screen.getByRole('textbox', {
    name: 'EN translation for login.0',
  }) as HTMLTextAreaElement
  fireEvent.change(field, { target: { value: 'My text' } })
  fireEvent.blur(field)
  await screen.findByText('Competing translation')
  expect(field.value).toBe('My text')
  expect(
    (screen.getByRole('button', { name: /Publish batch/ }) as HTMLButtonElement).disabled
  ).toBe(true)
})
it('rejects stale publication, displays fresh values, and requires another explicit click', async () => {
  vi.mocked(stringsApi.batch)
    .mockImplementationOnce(async () => {
      batch.fingerprint = 'fresh'
      batch.items[0].source_text = 'Latest source'
      throw new ApiError(409, 'Changed', { detail: { code: 'publish_fingerprint_mismatch' } })
    })
    .mockResolvedValue({ affected: 1, batch_id: 'publication' })
  show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: /Publish batch/ }))
  await screen.findByText('Latest source')
  expect(stringsApi.batch).toHaveBeenCalledTimes(1)
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: /Publish batch/ }) as HTMLButtonElement).disabled
    ).toBe(false)
  )
  fireEvent.click(screen.getByRole('button', { name: /Publish batch/ }))
  await waitFor(() =>
    expect(stringsApi.batch).toHaveBeenLastCalledWith(
      'demo',
      expect.objectContaining({ fingerprint: 'fresh' })
    )
  )
})
it('applies in chunks and retries only the remaining chunk after a failure', async () => {
  vi.mocked(stringsApi.translateProposals).mockResolvedValue({
    items: Array.from({ length: 101 }, (_, i) => proposal(i)),
    locales: ['en'],
    job_id: null,
    total: 101,
    page: 1,
    page_size: 101,
  })
  vi.mocked(stringsApi.translateApply)
    .mockResolvedValueOnce({ translated_count: 100, locales: ['en'], batch_id: 'a' })
    .mockRejectedValueOnce(new Error('Temporary failure'))
    .mockResolvedValue({ translated_count: 1, locales: ['en'], batch_id: 'b' })
  show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry saving 1 remaining strings' }))
  await waitFor(() => expect(stringsApi.translateApply).toHaveBeenCalledTimes(3))
  expect(
    vi.mocked(stringsApi.translateApply).mock.calls.map((call) => call[1].items.length)
  ).toEqual([100, 1, 1])
  expect(stringsApi.batch).not.toHaveBeenCalled()
})
it('keeps concurrent human translations when resolving generated-result conflicts', async () => {
  vi.mocked(stringsApi.translateApply).mockRejectedValueOnce(
    new ApiError(409, 'Changed translation', {
      detail: { conflicts: [{ string_id: 's0' }] },
    })
  )
  show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Keep latest for changed strings' }))
  await screen.findByText(/Kept the latest translations/)
  expect(stringsApi.translateApply).toHaveBeenCalledTimes(1)
})
it('does not limit translation to the currently displayed page', async () => {
  batch.items = Array.from({ length: 51 }, (_, i) => entry(i))
  show()
  await screen.findByText('51 strings in this batch')
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  expect(screen.getByText('login.50')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await waitFor(() => expect(stringsApi.translateProposals).toHaveBeenCalled())
  expect(vi.mocked(stringsApi.translateProposals).mock.calls[0][1].string_ids).toBeUndefined()
  expect(vi.mocked(stringsApi.translateProposals).mock.calls[0][1].batch_id).toBe('push')
})
it('reports failed background generation without applying or publishing', async () => {
  vi.mocked(stringsApi.translateProposals).mockResolvedValue({
    items: [],
    job_id: 'job',
    locales: ['en'],
    total: 1,
    page: 1,
    page_size: 1,
  })
  vi.mocked(jobsApi.get).mockResolvedValue({
    id: 'job',
    kind: 'translate_proposals',
    status: 'failed',
    result: null,
    error: 'AI unavailable',
    created_at: null,
    completed_at: null,
    progress: null,
  })
  show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await screen.findByText('AI unavailable')
  expect(stringsApi.translateApply).not.toHaveBeenCalled()
  expect(stringsApi.batch).not.toHaveBeenCalled()
})

it('resumes a completed background job and applies its baselines exactly once', async () => {
  sessionStorage.setItem('x-locale-batch-job:demo:push', 'resumed-job')
  vi.mocked(jobsApi.get).mockResolvedValue({
    id: 'resumed-job',
    kind: 'translate_proposals',
    status: 'completed',
    result: { items: [proposal()] },
    error: null,
    created_at: null,
    completed_at: null,
    progress: null,
  })
  show()
  await screen.findByText(/Translations saved to working copy/)
  expect(stringsApi.translateApply).toHaveBeenCalledTimes(1)
  expect(stringsApi.translateProposals).not.toHaveBeenCalled()
  expect(sessionStorage.getItem('x-locale-batch-job:demo:push')).toBeNull()
  expect(stringsApi.batch).not.toHaveBeenCalled()
})
