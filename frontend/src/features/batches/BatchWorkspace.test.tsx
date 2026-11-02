import { useBlocker } from '@tanstack/react-router'
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
    publishCliPushBatch: vi.fn(),
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
  vi.mocked(useBlocker).mockReturnValue({ status: 'idle' } as ReturnType<typeof useBlocker>)
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
  vi.mocked(stringsApi.translateProposals).mockResolvedValue({
    items: [proposal()],
    locales: ['en'],
    job_id: null,
    total: 1,
    page: 1,
    page_size: 50,
  })
  vi.mocked(stringsApi.publishCliPushBatch).mockResolvedValue({
    affected: 1,
    batch_id: 'publication',
  })
})
afterEach(() => {
  cleanup()
  qc.clear()
})

it('keeps generated translations temporary and never calls intermediate write APIs', async () => {
  show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await screen.findByText(/Translations are ready for review/)
  expect(
    (screen.getByRole('textbox', { name: 'EN translation for login.0' }) as HTMLTextAreaElement)
      .value
  ).toBe('Generated')
  expect(stringsApi.update).not.toHaveBeenCalled()
  expect(stringsApi.translateApply).not.toHaveBeenCalled()
  expect(stringsApi.publishCliPushBatch).not.toHaveBeenCalled()
  expect(batch.items[0].translations[0].value).toBe('Old')
})
it('keeps blur edits local and sends one atomic publication request', async () => {
  show()
  await loaded()
  const field = screen.getByRole('textbox', { name: 'EN translation for login.0' })
  fireEvent.change(field, { target: { value: 'Human edit' } })
  fireEvent.blur(field)
  expect(stringsApi.update).not.toHaveBeenCalled()
  expect(stringsApi.translateApply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Publish batch/ }))
  await waitFor(() =>
    expect(stringsApi.publishCliPushBatch).toHaveBeenCalledWith('demo', 'push', {
      fingerprint: 'reviewed',
      items: [
        {
          string_id: 's0',
          expected_source_text: 'Nguồn mới',
          translations: { en: 'Human edit' },
          scores: { en: null },
        },
      ],
    })
  )
})
it('discards temporary translations when the workflow is left and reopened', async () => {
  const view = show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await screen.findByText(/Translations are ready for review/)
  view.unmount()
  show()
  await loaded()
  expect(
    (screen.getByRole('textbox', { name: 'EN translation for login.0' }) as HTMLTextAreaElement)
      .value
  ).toBe('Old')
  expect(jobsApi.get).not.toHaveBeenCalled()
  expect(stringsApi.translateApply).not.toHaveBeenCalled()
  expect(stringsApi.publishCliPushBatch).not.toHaveBeenCalled()
})
it('does not resume previously stored jobs after reloading', async () => {
  sessionStorage.setItem('x-locale-batch-job:demo:push', 'abandoned-job')
  show()
  await loaded()
  expect(jobsApi.get).not.toHaveBeenCalled()
  expect(
    (screen.getByRole('textbox', { name: 'EN translation for login.0' }) as HTMLTextAreaElement)
      .value
  ).toBe('Old')
})
it('retains all temporary edits after a failed final transaction and can retry it', async () => {
  vi.mocked(stringsApi.publishCliPushBatch)
    .mockRejectedValueOnce(new Error('Publication failed'))
    .mockResolvedValue({ affected: 1, batch_id: 'b' })
  show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await screen.findByText(/Translations are ready for review/)
  fireEvent.click(screen.getByRole('button', { name: /Publish batch/ }))
  await screen.findByText('Publication failed')
  expect(
    (screen.getByRole('textbox', { name: 'EN translation for login.0' }) as HTMLTextAreaElement)
      .value
  ).toBe('Generated')
  fireEvent.click(screen.getByRole('button', { name: /Publish batch/ }))
  await waitFor(() => expect(stringsApi.publishCliPushBatch).toHaveBeenCalledTimes(2))
  expect(stringsApi.translateApply).not.toHaveBeenCalled()
})
it('requires restarting after a stale final snapshot and discards old temporary values', async () => {
  vi.mocked(stringsApi.publishCliPushBatch).mockRejectedValueOnce(
    new ApiError(409, 'Changed', { detail: { code: 'publish_fingerprint_mismatch' } })
  )
  show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await screen.findByText(/Translations are ready for review/)
  fireEvent.click(screen.getByRole('button', { name: /Publish batch/ }))
  await screen.findByText(/The batch changed. Nothing was saved/)
  expect(
    (screen.getByRole('button', { name: /Publish batch/ }) as HTMLButtonElement).disabled
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Restart workflow' }))
  await screen.findByRole('alertdialog', { name: 'Restart this workflow?' })
  fireEvent.click(screen.getByRole('button', { name: 'Discard and restart' }))
  await waitFor(() =>
    expect(
      (screen.getByRole('textbox', { name: 'EN translation for login.0' }) as HTMLTextAreaElement)
        .value
    ).toBe('Old')
  )
  expect(stringsApi.publishCliPushBatch).toHaveBeenCalledTimes(1)
})
it('publishes over 100 staged strings in a single final request across pages', async () => {
  batch.items = Array.from({ length: 101 }, (_, i) => entry(i))
  vi.mocked(stringsApi.translateProposals).mockResolvedValue({
    items: Array.from({ length: 101 }, (_, i) => proposal(i)),
    locales: ['en'],
    job_id: null,
    total: 101,
    page: 1,
    page_size: 101,
  })
  show()
  await screen.findByText('101 strings in this batch')
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await screen.findByText(/Translations are ready for review/)
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  expect(
    (screen.getByRole('textbox', { name: 'EN translation for login.50' }) as HTMLTextAreaElement)
      .value
  ).toBe('Generated')
  fireEvent.click(screen.getByRole('button', { name: /Publish batch/ }))
  await waitFor(() => expect(stringsApi.publishCliPushBatch).toHaveBeenCalledTimes(1))
  expect(vi.mocked(stringsApi.publishCliPushBatch).mock.calls[0][2].items.length).toBe(101)
  expect(stringsApi.translateApply).not.toHaveBeenCalled()
})
it('stages successful async results in memory only', async () => {
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
    status: 'completed',
    result: { items: [proposal()] },
    error: null,
    created_at: null,
    completed_at: null,
    progress: null,
  })
  show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await screen.findByText(/Translations are ready for review/)
  expect(stringsApi.translateApply).not.toHaveBeenCalled()
  expect(stringsApi.publishCliPushBatch).not.toHaveBeenCalled()
  expect(sessionStorage.getItem('x-locale-batch-job:demo:push')).toBeNull()
})
it('does not stage a late response after leaving the workflow', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof stringsApi.translateProposals>>) => void
  vi.mocked(stringsApi.translateProposals).mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  const view = show()
  await loaded()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  view.unmount()
  resolve({ items: [proposal()], job_id: null, locales: ['en'], total: 1, page: 1, page_size: 1 })
  show()
  await loaded()
  expect(
    (screen.getByRole('textbox', { name: 'EN translation for login.0' }) as HTMLTextAreaElement)
      .value
  ).toBe('Old')
  expect(stringsApi.translateApply).not.toHaveBeenCalled()
})

it('uses every project target language automatically and marks the current review step', async () => {
  show()
  await loaded()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(
    screen.getByText('Translate', { exact: false, selector: 'li[aria-current="step"] span' })
  ).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Translate all' }))
  await screen.findByText(/Translations are ready for review/)
  expect(stringsApi.translateProposals).toHaveBeenCalledWith(
    'demo',
    expect.objectContaining({ locales: ['en', 'ja'], batch_id: 'push' })
  )
  expect(
    screen.getByText('Review', { exact: true }).closest('li')?.getAttribute('aria-current')
  ).toBe('step')
})
it('keeps temporary edits when restart is cancelled and discards them only after confirmation', async () => {
  const confirm = vi.spyOn(window, 'confirm')
  show()
  await loaded()
  const field = screen.getByRole('textbox', { name: 'EN translation for login.0' })
  fireEvent.change(field, { target: { value: 'My review' } })
  fireEvent.click(screen.getByRole('button', { name: 'Restart workflow' }))
  await screen.findByRole('alertdialog', { name: 'Restart this workflow?' })
  fireEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }))
  expect((field as HTMLTextAreaElement).value).toBe('My review')
  fireEvent.click(screen.getByRole('button', { name: 'Restart workflow' }))
  fireEvent.click(screen.getByRole('button', { name: 'Discard and restart' }))
  await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe('Old'))
  expect(confirm).not.toHaveBeenCalled()
})
it('uses the shadcn leave dialog to cancel or continue blocked navigation', async () => {
  const reset = vi.fn()
  const proceed = vi.fn()
  vi.mocked(useBlocker).mockReturnValue({
    status: 'blocked',
    reset,
    proceed,
  } as unknown as ReturnType<typeof useBlocker>)
  show()
  await screen.findByRole('alertdialog', { name: 'Leave this workflow?' })
  fireEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(proceed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Discard and leave' }))
  expect(proceed).toHaveBeenCalledTimes(1)
})
it('shows pending translations outside project targets for publication review', async () => {
  batch.items[0].translations.push({
    id: null,
    updated_at: null,
    locale: 'fr',
    value: 'En attente',
    published_value: 'Ancien',
    confidence: null,
  })
  show()
  await loaded()
  expect(
    (screen.getByRole('textbox', { name: 'FR translation for login.0' }) as HTMLTextAreaElement)
      .value
  ).toBe('En attente')
  expect(screen.getByText('Ancien')).toBeDefined()
})

it('distinguishes published values from changes to publish', async () => {
  show()
  await loaded()
  expect(screen.getByLabelText('Published source')).toBeDefined()
  expect(screen.getByText('Nguồn cũ')).toBeDefined()
  expect(screen.getByText('Source to publish:')).toBeDefined()
  expect(screen.getAllByText('No change from published')).toHaveLength(2)
  fireEvent.change(screen.getByRole('textbox', { name: 'EN translation for login.0' }), {
    target: { value: 'New text' },
  })
  expect(screen.getAllByText('Changed from published')).toHaveLength(1)
  expect(screen.getByText('Old')).toBeDefined()
})
