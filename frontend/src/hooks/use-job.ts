import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import { getActiveJob, getStoppedJobId, subscribeActiveJob } from '@/lib/active-job'
import type { ApiError } from '@/lib/api/client'
import { isJobFinished, jobError, jobsApi } from '@/lib/api/jobs'
import type { Job } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'

const POLL_MS = 1000

type JobHandlers = {
  onCompleted: (job: Job) => void
  onFailed: (error: ApiError, job: Job) => void
  onStopped?: () => void
}

/** Poll a background job every second and call one handler once when it ends. */
export function useJob(jobId: string | null, handlers: JobHandlers) {
  const client = useQueryClient()
  const active = useSyncExternalStore(subscribeActiveJob, getActiveJob)
  const stopped = useSyncExternalStore(subscribeActiveJob, getStoppedJobId)
  const pollUntil = active?.jobId === jobId ? active.pollUntil : 0
  const [now, setNow] = useState(Date.now)
  const isStopped = Boolean(jobId && stopped === jobId)
  const isPaused = Boolean(jobId && (pollUntil <= now || isStopped))
  const query = useQuery({
    queryKey: queryKeys.jobs.detail(jobId ?? ''),
    queryFn: ({ signal }) => jobsApi.get(jobId!, signal),
    enabled: Boolean(jobId) && !isPaused,
    staleTime: 0,
    refetchOnMount: () => !isStopped && Date.now() < pollUntil,
    refetchOnWindowFocus: () => !isStopped && Date.now() < pollUntil,
    refetchOnReconnect: () => !isStopped && Date.now() < pollUntil,
    retry: (failureCount, error) => {
      if (isStopped || Date.now() >= pollUntil) return false
      const retry = client.getDefaultOptions().queries?.retry ?? 3
      return typeof retry === 'function' ? retry(failureCount, error)
        : retry === true || (typeof retry === 'number' && failureCount < retry)
    },
    refetchInterval: (current) =>
      isPaused || Date.now() >= pollUntil || current.state.status === 'error'
        || isJobFinished(current.state.data) ? false : POLL_MS,
  })
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (!jobId || isStopped) return
    const remaining = pollUntil - Date.now()
    const timer = window.setTimeout(() => {
      setNow(Date.now())
      // An already-expired observer may be joining another observer's manual check.
      if (remaining <= 0) return
      const key = queryKeys.jobs.detail(jobId)
      if (!isJobFinished(client.getQueryData<Job>(key))) {
        void client.cancelQueries({ queryKey: key, exact: true })
      }
    }, Math.max(0, remaining))
    return () => window.clearTimeout(timer)
  }, [jobId, pollUntil, isStopped, client])

  const stop = useEffectEvent(() => handlers.onStopped?.())
  useEffect(() => {
    if (!jobId || !isStopped || handled.current === jobId) return
    handled.current = jobId
    void client.cancelQueries({ queryKey: queryKeys.jobs.detail(jobId), exact: true })
    stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Effect Events must not be dependencies.
  }, [jobId, isStopped, client])

  const succeed = useEffectEvent((job: Job) => {
    handlers.onCompleted(job)
  })
  const fail = useEffectEvent((error: ApiError, job: Job) => {
    handlers.onFailed(error, job)
  })

  const job = query.data
  useEffect(() => {
    if (!jobId || isStopped || handled.current === jobId || query.isError) return
    if (!job || job.id !== jobId || !isJobFinished(job)) return
    handled.current = jobId
    if (job.status === 'completed') succeed(job)
    else fail(jobError(job), job)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Effect Events must not be dependencies.
  }, [jobId, job, query.isError, isStopped])

  return { ...query, isPaused: isPaused && !isJobFinished(job) }
}
