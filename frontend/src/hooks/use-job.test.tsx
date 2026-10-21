import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { claimFinish, clearActiveJob, getActiveJob, JOB_POLL_LIMIT_MS, rememberJob, stopTrackingJob } from '@/lib/active-job'
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
  vi.useRealTimers()
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
})

function setup(handlers = { onCompleted: vi.fn(), onFailed: vi.fn(), onStopped: vi.fn() }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useJob(completed.id, handlers), { wrapper })
  return { ...hook, client, handlers, wrapper }
}

it('pauses after five minutes, survives remount/focus/reconnect, and checks manually once', async () => {
  vi.useFakeTimers()
  rememberJob({ jobId: completed.id, projectId: 'proj-1', kind: 'import' })
  vi.mocked(jobsApi.get).mockResolvedValue({ ...completed, status: 'running' })
  const hook = setup()
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_LIMIT_MS) })
    expect(hook.result.current.isPaused).toBe(true)
    const count = vi.mocked(jobsApi.get).mock.calls.length
    expect(count).toBeGreaterThan(1)
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(jobsApi.get).toHaveBeenCalledTimes(count)
    hook.unmount()
    const resumed = renderHook(() => useJob(completed.id, hook.handlers), { wrapper: hook.wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(resumed.result.current.isPaused).toBe(true)
    expect(jobsApi.get).toHaveBeenCalledTimes(count)
    await act(async () => { await resumed.result.current.refetch() })
    expect(jobsApi.get).toHaveBeenCalledTimes(count + 1)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(jobsApi.get).toHaveBeenCalledTimes(count + 1)
    vi.mocked(jobsApi.get).mockResolvedValue(completed)
    await act(async () => { await resumed.result.current.refetch(); await vi.advanceTimersByTimeAsync(1) })
    expect(hook.handlers.onCompleted).toHaveBeenCalledTimes(1)
    expect(hook.handlers.onFailed).not.toHaveBeenCalled()
    resumed.unmount()
  } finally {
    hook.unmount()
    hook.client.clear()
  }
})

it.each(['timeout', 'dismiss'] as const)('aborts an outstanding request on %s without reporting job failure', async (action) => {
  vi.useFakeTimers()
  rememberJob({ jobId: completed.id, projectId: 'proj-1', kind: 'import' })
  let signal: AbortSignal | undefined
  vi.mocked(jobsApi.get).mockImplementation((_id, input) => {
    signal = input
    return new Promise((_resolve, reject) => {
      input?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })
  })
  const hook = setup()
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(signal?.aborted).toBe(false)
    await act(async () => {
      if (action === 'dismiss') stopTrackingJob(completed.id)
      else await vi.advanceTimersByTimeAsync(JOB_POLL_LIMIT_MS)
    })
    expect(signal?.aborted).toBe(true)
    expect(hook.handlers.onFailed).not.toHaveBeenCalled()
    expect(hook.handlers.onCompleted).not.toHaveBeenCalled()
    expect(hook.handlers.onStopped).toHaveBeenCalledTimes(action === 'dismiss' ? 1 : 0)
    expect(getActiveJob()?.jobId).toBe(action === 'dismiss' ? undefined : completed.id)
  } finally {
    hook.unmount()
    hook.client.clear()
  }
})

it('two observers share a deadline and stopping notifies both local flows', async () => {
  rememberJob({ jobId: completed.id, projectId: 'proj-1', kind: 'import', pollUntil: 0 })
  const hook = setup()
  const stopped = vi.fn()
  const second = renderHook(() => useJob(completed.id, {
    onCompleted: vi.fn(), onFailed: vi.fn(), onStopped: stopped,
  }), { wrapper: hook.wrapper })
  try {
    expect(hook.result.current.isPaused).toBe(true)
    expect(jobsApi.get).not.toHaveBeenCalled()
    await act(async () => { stopTrackingJob(completed.id) })
    expect(hook.handlers.onStopped).toHaveBeenCalledTimes(1)
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('x-locale-active-job')).toBeNull()
  } finally {
    second.unmount()
    hook.unmount()
    hook.client.clear()
  }
})

it.each(['running', 'completed'] as const)('preserves a manual %s result when an expired page observer mounts', async (status) => {
  vi.useFakeTimers()
  rememberJob({ jobId: completed.id, projectId: 'proj-1', kind: 'import', pollUntil: 0 })
  let resolve!: (job: Job) => void
  let signal: AbortSignal | undefined
  vi.mocked(jobsApi.get).mockImplementation((_id, input) => {
    signal = input
    return new Promise<Job>((finish) => { resolve = finish })
  })
  const layout = setup()
  let unmountPage: (() => void) | undefined
  const pageHandlers = { onCompleted: vi.fn(), onFailed: vi.fn() }
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    let request!: ReturnType<typeof layout.result.current.refetch>
    act(() => { request = layout.result.current.refetch() })
    expect(signal?.aborted).toBe(false)
    const page = renderHook(() => useJob(completed.id, pageHandlers), { wrapper: layout.wrapper })
    // Both observers must share the existing request, as they do during navigation.
    unmountPage = page.unmount
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(signal?.aborted).toBe(false)
    await act(async () => {
      resolve({ ...completed, status })
      await request
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(layout.result.current.data?.status).toBe(status)
    expect(page.result.current.data?.status).toBe(status)
    expect(layout.handlers.onCompleted).toHaveBeenCalledTimes(status === 'completed' ? 1 : 0)
    expect(pageHandlers.onCompleted).toHaveBeenCalledTimes(status === 'completed' ? 1 : 0)
    expect(layout.handlers.onFailed).not.toHaveBeenCalled()
    expect(pageHandlers.onFailed).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(jobsApi.get).toHaveBeenCalledTimes(1)
  } finally {
    unmountPage?.()
    layout.unmount()
    layout.client.clear()
  }
})

it('a paused manual check makes only one request even when the client normally retries', async () => {
  rememberJob({ jobId: completed.id, projectId: 'proj-1', kind: 'import', pollUntil: 0 })
  vi.mocked(jobsApi.get).mockRejectedValue(new ApiError(503, 'Unavailable'))
  const client = new QueryClient({ defaultOptions: { queries: { retry: 2 } } })
  const handlers = { onCompleted: vi.fn(), onFailed: vi.fn() }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useJob(completed.id, handlers), { wrapper })
  try {
    await act(async () => { await hook.result.current.refetch() })
    expect(jobsApi.get).toHaveBeenCalledTimes(1)
    expect(handlers.onFailed).not.toHaveBeenCalled()
    expect(getActiveJob()?.jobId).toBe(completed.id)
  } finally {
    hook.unmount()
    client.clear()
  }
})

it('checks the wall clock on focus even if a background tab has delayed its expiry timer', async () => {
  vi.useFakeTimers()
  rememberJob({ jobId: completed.id, projectId: 'proj-1', kind: 'import' })
  vi.mocked(jobsApi.get).mockResolvedValue({ ...completed, status: 'running' })
  const hook = setup()
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    const count = vi.mocked(jobsApi.get).mock.calls.length
    await act(async () => {
      vi.setSystemTime(Date.now() + JOB_POLL_LIMIT_MS)
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(jobsApi.get).toHaveBeenCalledTimes(count)
  } finally {
    hook.unmount()
    hook.client.clear()
  }
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
