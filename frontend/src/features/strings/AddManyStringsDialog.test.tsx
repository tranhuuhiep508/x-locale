import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { clearActiveJob, getActiveJob, rememberJob } from '@/lib/active-job'
import { ApiError } from '@/lib/api/client'
import { jobsApi } from '@/lib/api/jobs'
import { syncApi } from '@/lib/api/sync'
import type { ImportResult, Job, Module, Project, Tag } from '@/lib/api/types'
import { AddManyStringsDialog } from './AddManyStringsDialog'

vi.mock('@/lib/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock('@/lib/api/catalog', () => ({
  modulesApi: { create: vi.fn() },
  tagsApi: { create: vi.fn() },
}))

vi.mock('@/lib/api/sync', () => ({
  syncApi: { importFile: vi.fn() },
}))

vi.mock('@/lib/api/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/jobs')>()),
  jobsApi: { get: vi.fn() },
}))

const project: Project = {
  can_change_base_language: false,
  id: 'proj-1',
  name: 'Demo App',
  slug: 'demo-app',
  base_language: 'vi',
  target_languages: ['en'],
  layout: 'modular',
  allow_duplicate_keys: false, string_count: 10,
  created_at: null,
  updated_at: null,
  translation_context: null,
}

const modules: Module[] = [
  { id: 'mod-common', slug: 'common', name: 'Common', description: null, translation_context: null, position: 0, string_count: 4 },
]

const tags: Tag[] = [{ id: 'tag-ios', name: 'ios', color: '#2563eb', string_count: 0 }]

const dryResult: ImportResult = {
  created: 0,
  updated: 0,
  total: 2,
  dry_run: true,
  batch_id: null,
  diff: {
    create: [{ key: 'e2e_new', source_text: 'Mới' }],
    update: [{ key: 'save', source_text: 'Lưu lại' }],
    orphan: [],
    create_count: 1,
    update_count: 1,
    orphan_count: 0,
  },
}

const applyResult: ImportResult = {
  ...dryResult,
  created: 1,
  updated: 1,
  dry_run: false,
  batch_id: 'batch-1',
}

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
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
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

function renderDialog(onSuccess = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
  const view = render(
    <AddManyStringsDialog
      open
      projectId="proj-1"
      project={project}
      modules={modules}
      tags={tags}
      onClose={onClose}
      onSuccess={onSuccess}
    />,
    { wrapper },
  )
  return { ...view, client, onSuccess, onClose }
}

describe('AddManyStringsDialog', () => {
  beforeEach(() => {
    polyfillPointer()
    clearActiveJob()
    vi.mocked(syncApi.importFile).mockReset()
    vi.mocked(jobsApi.get).mockReset()
  })

  it('polls a background import job and shows its preview', async () => {
    const running: Job = {
      id: 'job-1',
      kind: 'import',
      status: 'running',
      result: null,
      error: null,
      created_at: null,
      completed_at: null,
      progress: { phase: 'validating', chunks_done: 0, chunks_total: 0 },
    }
    renderDialog()
    vi.mocked(syncApi.importFile).mockResolvedValueOnce({
      job_id: 'job-1',
      status: 'running',
      kind: 'import',
    })
    vi.mocked(jobsApi.get)
      .mockResolvedValueOnce(running)
      .mockResolvedValue({
        ...running,
        status: 'completed',
        result: dryResult as unknown as Record<string, unknown>,
      })

    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: '{"save": "Lưu lại", "e2e_new": "Mới"}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByText('Checking keys…')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Preview/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(await screen.findByText(/\+ e2e_new/, undefined, { timeout: 3000 })).toBeTruthy()
    expect(jobsApi.get).toHaveBeenCalledWith('job-1')
    expect(screen.queryByText('Checking keys…')).toBeNull()
  })

  it('returns to the paste step when the background job fails', async () => {
    renderDialog()
    vi.mocked(syncApi.importFile).mockResolvedValueOnce({
      job_id: 'job-2',
      status: 'running',
      kind: 'import',
    })
    vi.mocked(jobsApi.get).mockResolvedValue({
      id: 'job-2',
      kind: 'import',
      status: 'failed',
      result: { error: { status_code: 400, detail: 'Invalid import' } },
      error: 'Invalid import',
      created_at: null,
      completed_at: null,
      progress: null,
    })

    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: '{"save": "Lưu"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    expect(jobsApi.get).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('New strings')).toBeNull()
  })

  it.each([404, 503])('keeps the job after a %s poll error and retries status', async (status) => {
    const { onClose } = renderDialog()
    vi.mocked(syncApi.importFile).mockResolvedValueOnce({
      job_id: 'job-retry', status: 'running', kind: 'import',
    })
    vi.mocked(jobsApi.get).mockRejectedValue(new ApiError(status, 'Could not check job'))

    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: '{"save": "Lưu"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByRole('button', { name: 'Retry status' })).toBeTruthy()
    expect((screen.getByRole('button', { name: /Preview/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false)
    expect(getActiveJob()?.jobId).toBe('job-retry')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(getActiveJob()?.jobId).toBe('job-retry')
    const calls = vi.mocked(jobsApi.get).mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(vi.mocked(jobsApi.get).mock.calls.length).toBe(calls)

    vi.mocked(jobsApi.get).mockResolvedValue({
      id: 'job-retry', kind: 'import', status: 'completed',
      result: dryResult as unknown as Record<string, unknown>, error: null,
      created_at: null, completed_at: null, progress: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry status' }))
    expect(await screen.findByText('New strings')).toBeTruthy()
    expect(getActiveJob()).toBeNull()
    expect(syncApi.importFile).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('keeps pending preview input across close and reopen (finishes while closed: %s)', async (finishesWhileClosed) => {
    const { rerender, client, onClose, onSuccess } = renderDialog()
    const dialog = (open: boolean) => (
      <AddManyStringsDialog open={open} projectId="proj-1" project={project} modules={modules}
        tags={tags} onClose={onClose} onSuccess={onSuccess} />
    )
    vi.mocked(syncApi.importFile).mockResolvedValueOnce({
      job_id: 'reopen-preview', status: 'running', kind: 'import',
    })
    vi.mocked(jobsApi.get).mockRejectedValue(new ApiError(503, 'Poll unavailable'))
    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: '{"save":"Lưu lại","e2e_new":"Mới"}' },
    })
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Module' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Common' }))
    fireEvent.click(screen.getByRole('button', { name: 'ios' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByRole('button', { name: 'Retry status' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(dialog(false))
    vi.mocked(jobsApi.get).mockResolvedValue({
      id: 'reopen-preview', kind: 'import', status: 'completed',
      result: dryResult as unknown as Record<string, unknown>, error: null,
      created_at: null, completed_at: null, progress: null,
    })
    if (finishesWhileClosed) {
      await act(async () => { await client.refetchQueries({ queryKey: ['jobs', 'reopen-preview'] }) })
    }
    rerender(dialog(true))
    if (!finishesWhileClosed) {
      fireEvent.click(await screen.findByRole('button', { name: 'Retry status' }))
    }
    expect(await screen.findByText('New strings')).toBeTruthy()
    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    vi.mocked(syncApi.importFile).mockResolvedValue(applyResult)
    fireEvent.click(apply)
    await waitFor(() => expect(syncApi.importFile).toHaveBeenCalledTimes(2))
    const [, form, params] = vi.mocked(syncApi.importFile).mock.calls[1]
    expect(params).toMatchObject({ dry_run: 'false', module_id: 'mod-common', tag_ids: ['tag-ios'] })
    const payload = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(form.get('file') as File)
    })
    expect(JSON.parse(payload)).toEqual({ save: 'Lưu lại', e2e_new: 'Mới' })
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    rerender(dialog(false))
    rerender(dialog(true))
    expect((screen.getByLabelText('JSON') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'ios' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('requires a fresh preview when a resumed job has no original input', async () => {
    rememberJob({ jobId: 'reloaded-preview', projectId: 'proj-1', kind: 'add', dryRun: true })
    vi.mocked(jobsApi.get).mockResolvedValue({
      id: 'reloaded-preview', kind: 'import', status: 'completed',
      result: dryResult as unknown as Record<string, unknown>, error: null,
      created_at: null, completed_at: null, progress: null,
    })
    renderDialog()
    expect(await screen.findByText('New strings')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Go back and paste the JSON again/)).toBeTruthy()
    expect(syncApi.importFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    vi.mocked(syncApi.importFile).mockResolvedValueOnce(dryResult).mockResolvedValueOnce(applyResult)
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: '{"save":"Lưu lại"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText('New strings')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(syncApi.importFile).toHaveBeenCalledTimes(2))
  })

  it('can close an applied import after a poll error without submitting it twice', async () => {
    const { onSuccess, onClose } = renderDialog()
    vi.mocked(syncApi.importFile).mockResolvedValueOnce(dryResult).mockResolvedValueOnce({
      job_id: 'job-apply-retry', status: 'running', kind: 'import',
    })
    vi.mocked(jobsApi.get).mockRejectedValue(new ApiError(503, 'Could not check job'))
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: '{"save": "Lưu"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText('New strings')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('button', { name: 'Retry status' })).toBeTruthy()
    expect((screen.getByRole('button', { name: /Apply/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(getActiveJob()?.jobId).toBe('job-apply-retry')
    vi.mocked(jobsApi.get).mockResolvedValue({
      id: 'job-apply-retry', kind: 'import', status: 'completed',
      result: applyResult as unknown as Record<string, unknown>, error: null,
      created_at: null, completed_at: null, progress: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry status' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(getActiveJob()).toBeNull()
    expect(syncApi.importFile).toHaveBeenCalledTimes(2)
  })

  it('warns on duplicate keys and still previews the later values', async () => {
    renderDialog()
    vi.mocked(syncApi.importFile).mockResolvedValueOnce(dryResult)
    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: '{ "save": "one", "save": "two" }' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/Duplicate keys \("save"\)/)).toBeTruthy()
    expect(await screen.findByText('New strings')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false)
    expect(syncApi.importFile).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid JSON without calling import', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: '{not json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/Invalid JSON/)).toBeTruthy()
    expect(syncApi.importFile).not.toHaveBeenCalled()
  })

  it('rejects nested objects without calling import', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: '{"welcome": {"en": "Hi"}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/string value/)).toBeTruthy()
    expect(syncApi.importFile).not.toHaveBeenCalled()
  })

  it('shows an empty preview and disables Apply', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: '{}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText('New strings')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Apply/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(syncApi.importFile).not.toHaveBeenCalled()
  })

  it('dry-runs then applies through the JSON import endpoint', async () => {
    const { onSuccess, onClose } = renderDialog()
    vi.mocked(syncApi.importFile)
      .mockResolvedValueOnce(dryResult)
      .mockResolvedValueOnce(applyResult)

    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: '{"save": "Lưu lại", "e2e_new": "Mới"}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => expect(syncApi.importFile).toHaveBeenCalledTimes(1))
    const dryParams = vi.mocked(syncApi.importFile).mock.calls[0][2]
    expect(dryParams).toMatchObject({
      locale: 'vi',
      dry_run: 'true',
      status: 'draft',
      partial: 'true',
    })
    expect(await screen.findByText(/\+ e2e_new/)).toBeTruthy()
    expect(screen.getByText(/~ save/)).toBeTruthy()
    expect(screen.getByText('Mới')).toBeTruthy()
    expect(screen.getByText('Lưu lại')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(syncApi.importFile).toHaveBeenCalledTimes(2))
    expect(vi.mocked(syncApi.importFile).mock.calls[1][2]).toMatchObject({
      dry_run: 'false',
      status: 'draft',
      partial: 'true',
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Cancel on preview back does not apply', async () => {
    const { onSuccess } = renderDialog()
    vi.mocked(syncApi.importFile).mockResolvedValueOnce(dryResult)

    fireEvent.change(screen.getByLabelText('JSON'), {
      target: { value: '{"e2e_new": "Mới"}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/\+ e2e_new/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(syncApi.importFile).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
