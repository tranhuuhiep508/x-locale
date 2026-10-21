import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from 'react'
import {
  forgetJob, getActiveJob, isJobPollingPaused, resumeJobPolling, subscribeActiveJob,
} from '@/lib/active-job'
import type { ApiError } from '@/lib/api/client'
import { isJobFinished, jobError, jobsApi } from '@/lib/api/jobs'
import type { Job } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'

const POLL_MS = 1000

type JobHandlers = {
  onCompleted: (job: Job) => void
  onFailed: (error: ApiError, job: Job) => void
}

/** Poll a background job every second and call one handler once when it ends. */
export function useJob(jobId: string | null, handlers: JobHandlers) {
  const queryClient = useQueryClient()
  useSyncExternalStore(subscribeActiveJob, getActiveJob)
  const pollingPaused = isJobPollingPaused(jobId)
  const query = useQuery({
    queryKey: queryKeys.jobs.detail(jobId ?? ''),
    queryFn: () => jobsApi.get(jobId!),
    enabled: Boolean(jobId) && !pollingPaused,
    refetchOnWindowFocus: () => !isJobPollingPaused(jobId),
    refetchOnReconnect: () => !isJobPollingPaused(jobId),
    refetchInterval: (current) =>
      isJobPollingPaused(jobId) || current.state.status === 'error' ||
      isJobFinished(current.state.data) ? false : POLL_MS,
  })
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (pollingPaused && jobId) {
      void queryClient.cancelQueries({ queryKey: queryKeys.jobs.detail(jobId), exact: true })
    }
  }, [jobId, pollingPaused, queryClient])

  const succeed = useEffectEvent((job: Job) => {
    handlers.onCompleted(job)
  })
  const fail = useEffectEvent((error: ApiError, job: Job) => {
    handlers.onFailed(error, job)
  })

  const job = query.data
  useEffect(() => {
    if (!jobId || handled.current === jobId || query.isError) return
    if (!job || job.id !== jobId || !isJobFinished(job)) return
    handled.current = jobId
    if (job.status === 'completed') succeed(job)
    else fail(jobError(job), job)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Effect Events must not be dependencies.
  }, [jobId, job, query.isError])

  return {
    ...query,
    pollingPaused,
    checkAgain: () => {
      if (!jobId) return
      resumeJobPolling(jobId)
      void query.refetch()
    },
    dismiss: () => { if (jobId) forgetJob(jobId) },
  }
}
