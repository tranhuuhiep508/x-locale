import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  claimFinish, clearActiveJob, getActiveJob, JOB_POLL_TIMEOUT_MS, rememberJob, useActiveJobId,
} from '@/lib/active-job'
import { ApiError } from '@/lib/api/client'
import { jobsApi } from '@/lib/api/jobs'
import type { Job } from '@/lib/api/types'
import { useJob } from './use-job'

vi.mock('@/lib/api/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/jobs')>()),
  jobsApi: { get: vi.fn() },
}))

const completed: Job = {
  id: 'job-recovery', kind: 'import', status: 'completed',
  result: { created: 1, updated: 0 }, error: null,
  created_at: null, completed_at: null, progress: null,
}

beforeEach(() => {
  clearActiveJob()
  vi.mocked(jobsApi.get).mockReset()
})

afterEach(() => {
  clearActiveJob()
  vi.useRealTimers()
})

it('retains a job after a poll error and handles its result once after retry', async () => {
  rememberJob({ jobId: completed.id, projectId: 'proj-1', kind: 'import' })
  vi.mocked(jobsApi.get).mockRejectedValue(new ApiError(503, 'Gateway unavailable'))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const onCompleted = vi.fn((job: Job) => claimFinish(job.id))
  const onFailed = vi.fn(() => claimFinish(completed.id))
  const { result, unmount } = renderHook(
    () => useJob(completed.id, { onCompleted, onFailed }), { wrapper },
  )
  try {
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(onFailed).not.toHaveBeenCalled()
    expect(getActiveJob()?.jobId).toBe(completed.id)
    expect(JSON.parse(sessionStorage.getItem('x-locale-active-job')!).jobId).toBe(completed.id)

    vi.mocked(jobsApi.get).mockResolvedValue(completed)
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
    expect(getActiveJob()).toBeNull()
    await act(async () => { await result.current.refetch() })
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(onFailed).not.toHaveBeenCalled()
  } finally {
    unmount()
    client.clear()
  }
})

it('pauses all observers at the persisted deadline, resumes checking, and dismisses together', async () => {
  vi.useFakeTimers()
  rememberJob({
    jobId: completed.id, projectId: 'proj-1', kind: 'import',
    pollingStartedAt: Date.now() - JOB_POLL_TIMEOUT_MS + 1500,
  })
  vi.mocked(jobsApi.get).mockResolvedValue({ ...completed, status: 'running', result: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const onCompleted = vi.fn()
  const onFailed = vi.fn()
  const { result, unmount } = renderHook(() => {
    const id = useActiveJobId('proj-1', 'import')
    const page = useJob(id, { onCompleted, onFailed })
    const watcher = useJob(id, { onCompleted, onFailed })
    return { id, page, watcher }
  }, { wrapper })
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(result.current.page.pollingPaused).toBe(true)
    expect(result.current.watcher.pollingPaused).toBe(true)
    const polls = vi.mocked(jobsApi.get).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(jobsApi.get).toHaveBeenCalledTimes(polls)
    expect(onFailed).not.toHaveBeenCalled()
    expect(onCompleted).not.toHaveBeenCalled()

    await act(async () => { result.current.page.checkAgain() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(result.current.page.pollingPaused).toBe(false)
    expect(result.current.watcher.pollingPaused).toBe(false)
    expect(vi.mocked(jobsApi.get).mock.calls.length).toBeGreaterThan(polls)
    expect(JSON.parse(sessionStorage.getItem('x-locale-active-job')!).pollingStartedAt)
      .toBe(getActiveJob()?.pollingStartedAt)

    act(() => result.current.watcher.dismiss())
    expect(result.current.id).toBeNull()
    expect(sessionStorage.getItem('x-locale-active-job')).toBeNull()
    const dismissedPolls = vi.mocked(jobsApi.get).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(jobsApi.get).toHaveBeenCalledTimes(dismissedPolls)
    expect(onCompleted).not.toHaveBeenCalled()
    expect(onFailed).not.toHaveBeenCalled()
  } finally {
    unmount()
    client.clear()
  }
})

it('does not start a request for a job whose deadline expired before mounting', () => {
  rememberJob({
    jobId: completed.id, projectId: 'proj-1', kind: 'import',
    pollingStartedAt: Date.now() - JOB_POLL_TIMEOUT_MS - 1,
  })
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result, unmount } = renderHook(
    () => useJob(completed.id, { onCompleted: vi.fn(), onFailed: vi.fn() }), { wrapper },
  )
  try {
    expect(result.current.pollingPaused).toBe(true)
    expect(jobsApi.get).not.toHaveBeenCalled()
  } finally {
    unmount()
    client.clear()
  }
})

it('delivers completion to page and watcher but lets only one announce it', async () => {
  rememberJob({ jobId: completed.id, projectId: 'proj-1', kind: 'import' })
  vi.mocked(jobsApi.get).mockResolvedValue(completed)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const announces = vi.fn()
  const watcherCompleted = vi.fn((job: Job) => {
    if (claimFinish(job.id)) announces()
  })
  const pageCompleted = vi.fn((job: Job) => {
    if (claimFinish(job.id)) announces()
  })
  function Watcher() {
    const id = useActiveJobId('proj-1', 'import')
    useJob(id, { onCompleted: watcherCompleted, onFailed: vi.fn() })
    return null
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><Watcher />{children}</QueryClientProvider>
  )
  const { unmount } = renderHook(() => {
    const id = useActiveJobId('proj-1', 'import')
    return useJob(id, { onCompleted: pageCompleted, onFailed: vi.fn() })
  }, { wrapper })
  try {
    await waitFor(() => expect(pageCompleted).toHaveBeenCalledTimes(1))
    expect(watcherCompleted).toHaveBeenCalledTimes(1)
    expect(announces).toHaveBeenCalledTimes(1)
    expect(getActiveJob()).toBeNull()
  } finally {
    unmount()
    client.clear()
  }
})
