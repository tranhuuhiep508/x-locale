import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { claimFinish, clearActiveJob, getActiveJob, rememberJob } from '@/lib/active-job'
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
