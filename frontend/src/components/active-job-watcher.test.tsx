import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useJob } from '@/hooks/use-job'
import { claimFinish, clearActiveJob, getActiveJob, rememberJob } from '@/lib/active-job'
import { jobsApi } from '@/lib/api/jobs'
import type { Job } from '@/lib/api/types'
import { ActiveJobWatcher } from './active-job-watcher'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/toast', () => ({ useToast: () => toast }))
vi.mock('@/lib/api/jobs', async (original) => ({
  ...(await original<typeof import('@/lib/api/jobs')>()),
  jobsApi: { get: vi.fn() },
}))

const job: Job = {
  id: 'watcher-job', kind: 'import', status: 'running', result: null, error: null,
  progress: null, created_at: null, completed_at: null,
}

beforeEach(() => {
  clearActiveJob()
  vi.clearAllMocks()
  rememberJob({ jobId: job.id, projectId: 'project', kind: 'import', pollUntil: 0 })
})

function renderWatcher(local = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onLocalCompleted = vi.fn((finished: Job) => {
    if (claimFinish(finished.id)) toast.success('Local completion')
  })
  function LocalObserver() {
    useJob(job.id, { onCompleted: onLocalCompleted, onFailed: vi.fn() })
    return null
  }
  const view = render(
    <QueryClientProvider client={client}>
      <ActiveJobWatcher />
      {local ? <LocalObserver /> : null}
    </QueryClientProvider>,
  )
  return { ...view, client, onLocalCompleted }
}

it('offers one manual check and dismissal for a restored expired job', async () => {
  vi.mocked(jobsApi.get).mockResolvedValue(job)
  const view = renderWatcher()
  try {
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(jobsApi.get).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    await waitFor(() => expect(jobsApi.get).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('This does not cancel the operation on the server.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop tracking' }))
    await waitFor(() => expect(getActiveJob()).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    view.client.clear()
  }
})

it('announces a manual completion once with both the layout and initiating page observing', async () => {
  vi.mocked(jobsApi.get).mockResolvedValue({ ...job, status: 'completed', result: { created: 1 } })
  const view = renderWatcher(true)
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    await waitFor(() => expect(view.onLocalCompleted).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(getActiveJob()).toBeNull()
  } finally {
    view.unmount()
    view.client.clear()
  }
})

it('handles an interrupted result as a real failure after a manual check', async () => {
  vi.mocked(jobsApi.get).mockResolvedValue({
    ...job, status: 'failed', error: 'Interrupted. Please run it again.',
    result: { error: { status_code: 503, detail: { code: 'job_interrupted', message: 'Interrupted. Please run it again.' } } },
  })
  const view = renderWatcher()
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Interrupted. Please run it again.'))
    expect(getActiveJob()).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    view.client.clear()
  }
})
